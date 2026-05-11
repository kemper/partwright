// WebLLM-backed provider. Mirrors the surface of anthropic.ts so chatLoop
// can dispatch by provider without rewriting the loop body.
//
// Architecture notes:
//   * @mlc-ai/web-llm is imported dynamically so it ships in its own Vite
//     chunk — users who never open the local-model modal don't download the
//     ~14 MB engine.
//   * WebLLM's chat surface is OpenAI-shape, so we translate Anthropic-shape
//     ChatMessage[] both directions inside this module.
//   * Tool calls come back as `{ id, function: { name, arguments } }` with
//     arguments as a JSON-encoded string. We parse it here so chatLoop only
//     ever deals with parsed objects (matching what Anthropic returns).
//   * Hermes-3-Llama-3.1-8B is on WebLLM's `functionCallingModelIds`. The
//     other models we ship still get JSON-schema-constrained decoding via
//     XGrammar, which is enough for our tool list.

import type {
  ChatBlock,
  ChatMessage,
  ImageSource,
  PersistedToolCall,
  TurnUsage,
} from './types';
import type { ToolDefinition } from './tools';
import type { LocalModelId, LocalModelInfo } from './localModels';
import { findLocalModel, isWebGpuAvailable } from './localModels';

// We can't statically type-import from @mlc-ai/web-llm without forcing it
// into the main bundle, so we keep the engine handle untyped here and rely
// on duck-typing the methods we use.
interface LoadedEngine {
  modelId: LocalModelId;
  // The MLCEngine instance (typed loosely so this module doesn't drag the
  // 14 MB SDK into every chunk that imports our `types`).
  engine: any;
  info: LocalModelInfo;
}

let loaded: LoadedEngine | null = null;
let loadInFlight: Promise<LoadedEngine> | null = null;

export interface ProgressUpdate {
  /** 0..1, or NaN if WebLLM doesn't know yet. */
  progress: number;
  /** Human-readable progress, e.g. "Fetching param_shard_0.bin (12.4 MB)". */
  text: string;
}

export interface LoadOptions {
  onProgress?: (update: ProgressUpdate) => void;
}

/** Returns true when WebGPU + a discrete-enough adapter are available.
 *  Soft-fails (no exception) so the UI can render a "not supported" state
 *  rather than crashing on import. */
export async function probeWebGpu(): Promise<{ supported: boolean; adapter: GPUAdapter | null; reason?: string }> {
  if (!isWebGpuAvailable()) {
    return { supported: false, adapter: null, reason: 'navigator.gpu is not present in this browser.' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, adapter: null, reason: 'WebGPU is exposed but no compatible adapter is available.' };
    }
    return { supported: true, adapter };
  } catch (err) {
    return { supported: false, adapter: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Returns the model ids that already have weights cached locally, so the
 *  UI can show a "Loaded" pill instead of asking the user to re-download. */
export async function getCachedModels(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const webllm = await import('@mlc-ai/web-llm');
    const list = (webllm.prebuiltAppConfig.model_list ?? []) as { model_id: string; model: string }[];
    for (const entry of list) {
      // `hasModelInCache` is async and per-model; the public API takes the
      // model_id and looks up the URL behind the scenes.
      const cached = await webllm.hasModelInCache(entry.model_id, webllm.prebuiltAppConfig);
      if (cached) ids.add(entry.model_id);
    }
  } catch {
    // Cache check failures are non-fatal — we just under-report.
  }
  return ids;
}

/** Delete a model's cached weights. Used by the "Remove" button in the
 *  local-model modal. */
export async function deleteCachedModel(modelId: LocalModelId): Promise<void> {
  const webllm = await import('@mlc-ai/web-llm');
  await webllm.deleteModelAllInfoInCache(modelId, webllm.prebuiltAppConfig);
  if (loaded?.modelId === modelId) {
    try { await loaded.engine.unload?.(); } catch { /* noop */ }
    loaded = null;
  }
}

/** Whether a specific model is currently resident in GPU memory. The UI
 *  surfaces this so a second user message doesn't waste seconds re-loading
 *  weights into VRAM. */
export function isModelLoaded(modelId: LocalModelId): boolean {
  return loaded?.modelId === modelId;
}

/** Get the currently loaded model id, or null. */
export function loadedModelId(): LocalModelId | null {
  return loaded?.modelId ?? null;
}

/** Load (download if needed + activate) a model. Idempotent — calling again
 *  with the same id is a no-op; calling with a different id swaps. Single-
 *  flighted so two concurrent UI clicks don't race. */
export async function ensureModelLoaded(modelId: LocalModelId, opts: LoadOptions = {}): Promise<void> {
  if (loaded?.modelId === modelId) return;
  if (loadInFlight) {
    const current = await loadInFlight;
    if (current.modelId === modelId) return;
  }
  loadInFlight = (async () => {
    const info = findLocalModel(modelId);
    const webllm = await import('@mlc-ai/web-llm');

    // Unload a different model first to free VRAM before the next set of
    // weights arrives. Otherwise we'd briefly hold ~10 GB on a swap.
    if (loaded && loaded.modelId !== modelId) {
      try { await loaded.engine.unload?.(); } catch { /* noop */ }
      loaded = null;
    }

    const engine = new webllm.MLCEngine({
      // Default cache backend is "cache" (Cache API). Safari caps that at
      // ~1 GB; OPFS is uncapped after the storage permission prompt, so we
      // prefer it when available. WebLLM falls back if the browser lacks
      // OPFS.
      appConfig: { ...webllm.prebuiltAppConfig },
      initProgressCallback: (report: { progress: number; text: string }) => {
        opts.onProgress?.({ progress: report.progress, text: report.text });
      },
    });

    await engine.reload(modelId, {
      context_window_size: 4096,
    });

    const next: LoadedEngine = { modelId, engine, info };
    loaded = next;
    return next;
  })();

  try {
    await loadInFlight;
  } finally {
    loadInFlight = null;
  }
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onToolStart?: (toolUseId: string, toolName: string) => void;
}

export interface StreamResult {
  text: string;
  toolCalls: PersistedToolCall[];
  stopReason: string;
  usage: TurnUsage;
  /** True when the model didn't finish cleanly — hit max_tokens, or
   *  emitted an unclosed `<tool_call>` block (a crash, likely). chatLoop
   *  surfaces a "response was cut off" message and skips re-prompting. */
  truncated?: boolean;
}

export interface LocalRequestSpec {
  modelId: LocalModelId;
  systemPrompt: string;
  systemSuffix: string;
  /** Full prior conversation, oldest first, with the new user turn already
   *  appended at the end. We translate to OpenAI shape inside. */
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

/** Single agent-loop iteration against a local model. Mirrors the shape
 *  returned by anthropic.streamTurn so chatLoop can swap providers cleanly.
 *
 *  Two tool-calling strategies, chosen per model:
 *    * Native — Hermes-2-Pro / Hermes-3 are in WebLLM's `functionCallingModelIds`
 *      and accept the OpenAI `tools` request field. The model emits
 *      `tool_calls` deltas the same way the OpenAI API does.
 *    * Prompt-engineered — every other model rejects the `tools` field
 *      with an UnsupportedModelIdError. We inject tool descriptions into
 *      the system prompt and ask the model to emit `<tool_call>{...}</tool_call>`
 *      blocks, then parse them out post-stream. */
export async function streamLocalTurn(spec: LocalRequestSpec, callbacks: StreamCallbacks = {}): Promise<StreamResult> {
  if (!loaded || loaded.modelId !== spec.modelId) {
    throw new Error(`Local model ${spec.modelId} is not loaded. Open AI settings → Local model to download it first.`);
  }
  const { engine, info } = loaded;
  // Default is intentionally modest — local models share a 4K context with
  // the whole conversation. Reserving 768 for output leaves ~3300 tokens
  // for the system prompt + tool docs + scrollback.
  const maxTokens = spec.maxTokens ?? 768;
  const native = await supportsNativeToolCalls(spec.modelId);

  const systemSuffix = native
    ? spec.systemSuffix
    : appendPromptToolDocs(spec.systemSuffix, spec.tools);
  const messages = buildLocalApiMessages(spec.systemPrompt, systemSuffix, spec.history, info, native);

  const baseReq: Record<string, unknown> = {
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    temperature: 0.6,
  };
  if (native && spec.tools.length > 0) {
    baseReq.tools = buildOpenAiTools(spec.tools);
    baseReq.tool_choice = 'auto';
  }

  const stream = await engine.chat.completions.create(baseReq);

  let rawText = '';
  let stopReason = 'unknown';
  const toolBuf = new Map<number, { id: string; name: string; argsRaw: string; announced: boolean }>();
  const usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  // Track what we've emitted to the UI so we can suppress the prompt-engineered
  // tool-call markup mid-stream. We only emit deltas of clean text up to the
  // open `<tool_call>` marker; once the closing marker arrives we resume after it.
  let emittedLen = 0;
  let insideToolCall = false;
  let pendingToolCallId = 1;

  for await (const chunk of stream as AsyncIterable<any>) {
    const choice = chunk?.choices?.[0];
    if (choice?.delta?.content) {
      const delta = choice.delta.content as string;
      rawText += delta;
      if (native) {
        callbacks.onText?.(delta);
      } else {
        // Walk the buffer looking for tool-call markers as text accumulates.
        while (emittedLen < rawText.length) {
          if (!insideToolCall) {
            const openIdx = rawText.indexOf(TOOL_CALL_OPEN, emittedLen);
            if (openIdx === -1) {
              // No (incomplete) open marker present — emit everything up to
              // the safe cutoff (leave the last few chars unemitted so we
              // don't split the marker across deltas).
              const safe = Math.max(emittedLen, rawText.length - TOOL_CALL_OPEN.length);
              if (safe > emittedLen) {
                callbacks.onText?.(rawText.slice(emittedLen, safe));
                emittedLen = safe;
              }
              break;
            }
            // Emit text up to the open marker, then enter tool-call mode.
            if (openIdx > emittedLen) callbacks.onText?.(rawText.slice(emittedLen, openIdx));
            emittedLen = openIdx + TOOL_CALL_OPEN.length;
            insideToolCall = true;
            // Provisional announcement; the actual name is unknown until parse.
            callbacks.onToolStart?.(`tc_${pendingToolCallId++}`, 'tool');
          } else {
            const closeIdx = rawText.indexOf(TOOL_CALL_CLOSE, emittedLen);
            if (closeIdx === -1) break;
            emittedLen = closeIdx + TOOL_CALL_CLOSE.length;
            insideToolCall = false;
          }
        }
      }
    }
    if (native && choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
        const idx = tc.index ?? 0;
        let entry = toolBuf.get(idx);
        if (!entry) {
          entry = { id: tc.id ?? `tool_${idx}`, name: '', argsRaw: '', announced: false };
          toolBuf.set(idx, entry);
        }
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.argsRaw += tc.function.arguments;
        if (!entry.announced && entry.name) {
          entry.announced = true;
          callbacks.onToolStart?.(entry.id, entry.name);
        }
      }
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason;
    if (chunk?.usage) {
      usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
      usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
    }
  }

  // Final flush for the prompt-engineered path: anything still unemitted
  // outside a tool-call block goes out now.
  if (!native && !insideToolCall && emittedLen < rawText.length) {
    callbacks.onText?.(rawText.slice(emittedLen));
    emittedLen = rawText.length;
  }

  // Truncation detection: max_tokens was hit OR we're stuck mid-tool-call
  // with no closing marker. Either way, show the partial body to the user
  // so they understand what failed, and flag the result so chatLoop can
  // emit a "response was cut off" notice.
  const truncatedMidToolCall = !native && insideToolCall;
  const truncatedMaxTokens = stopReason === 'length' || stopReason === 'max_tokens';
  if (truncatedMidToolCall && emittedLen < rawText.length) {
    // Surface whatever fragment landed inside the unclosed tool call so
    // the user can see what the model was trying to do.
    callbacks.onText?.(`\n\n[partial output — tool call was cut off]\n${rawText.slice(emittedLen)}`);
    emittedLen = rawText.length;
  }

  let toolCalls: PersistedToolCall[] = [];
  let cleanedText: string;
  if (native) {
    toolCalls = collectNativeToolCalls(toolBuf);
    cleanedText = rawText;
  } else {
    const parsed = parsePromptToolCalls(rawText);
    toolCalls = parsed.toolCalls;
    cleanedText = parsed.cleanedText;
  }

  // Normalize finish_reason to match Anthropic vocabulary ("tool_use" /
  // "end_turn") so chatLoop's branching reads the same.
  let normStop = stopReason;
  if (toolCalls.length > 0 && !truncatedMidToolCall) normStop = 'tool_use';
  else if (truncatedMidToolCall || truncatedMaxTokens) normStop = 'max_tokens';
  else if (stopReason === 'stop') normStop = 'end_turn';

  return {
    text: cleanedText,
    toolCalls,
    stopReason: normStop,
    usage,
    truncated: truncatedMidToolCall || (truncatedMaxTokens && toolCalls.length === 0),
  };
}

/** Cached lookup of WebLLM's `functionCallingModelIds`. Async because the
 *  list lives inside the lazy-loaded WebLLM chunk. */
let nativeIdsCache: Set<string> | null = null;
async function supportsNativeToolCalls(modelId: string): Promise<boolean> {
  if (!nativeIdsCache) {
    const webllm = await import('@mlc-ai/web-llm');
    nativeIdsCache = new Set(webllm.functionCallingModelIds as readonly string[]);
  }
  return nativeIdsCache.has(modelId);
}

function collectNativeToolCalls(toolBuf: Map<number, { id: string; name: string; argsRaw: string }>): PersistedToolCall[] {
  const out: PersistedToolCall[] = [];
  for (const entry of toolBuf.values()) {
    if (!entry.name) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = entry.argsRaw.trim().length > 0 ? JSON.parse(entry.argsRaw) : {};
    } catch {
      parsed = { __raw: entry.argsRaw };
    }
    out.push({ id: entry.id, name: entry.name, input: parsed });
  }
  return out;
}

// === Prompt-engineered tool calling ===

const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = '</tool_call>';

/** Build a tool-use instruction block to append to the system prompt for
 *  models that don't accept the OpenAI `tools` request field. Kept terse —
 *  local models share a 4K context window with the whole conversation, so
 *  every token counts. We summarize each tool as one line:
 *      name(arg1: type[, ...]) — short description.
 *  Detailed JSON schema is omitted; the few tools whose arguments need
 *  call-time structure (paint, find) get a single-line example. */
function appendPromptToolDocs(existingSuffix: string, tools: ToolDefinition[]): string {
  if (tools.length === 0) return existingSuffix;
  const lines: string[] = [];
  if (existingSuffix.trim().length > 0) lines.push(existingSuffix);
  lines.push('');
  lines.push('## Tool calling');
  lines.push('');
  lines.push('Call a tool by emitting (verbatim):');
  lines.push('<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>');
  lines.push('After a tool call, stop and wait for the result. Multiple calls per turn are allowed.');
  lines.push('');
  lines.push('Available tools:');
  for (const t of tools) lines.push(`- ${compactToolSignature(t)}`);
  return lines.join('\n');
}

function compactToolSignature(t: ToolDefinition): string {
  const props = (t.input_schema.properties ?? {}) as Record<string, { type?: string; items?: { type?: string } }>;
  const required = new Set(t.input_schema.required ?? []);
  const args = Object.entries(props).map(([name, schema]) => {
    let type = schema.type ?? 'any';
    if (type === 'array' && schema.items?.type) type = `${schema.items.type}[]`;
    return required.has(name) ? `${name}: ${type}` : `${name}?: ${type}`;
  }).join(', ');
  // Trim description to a single sentence — most descriptions already end
  // at the first period.
  const shortDesc = t.description.split(/[.!]\s/)[0].trim();
  return `\`${t.name}(${args})\` — ${shortDesc}.`;
}

/** Pull `<tool_call>...</tool_call>` blocks out of a model response. Returns
 *  the cleaned conversational text (with markup stripped) plus parsed calls. */
function parsePromptToolCalls(text: string): { cleanedText: string; toolCalls: PersistedToolCall[] } {
  const calls: PersistedToolCall[] = [];
  let cleaned = '';
  let cursor = 0;
  let n = 0;
  while (cursor < text.length) {
    const open = text.indexOf(TOOL_CALL_OPEN, cursor);
    if (open === -1) {
      cleaned += text.slice(cursor);
      break;
    }
    cleaned += text.slice(cursor, open);
    const close = text.indexOf(TOOL_CALL_CLOSE, open + TOOL_CALL_OPEN.length);
    if (close === -1) {
      // Truncated — keep what we have and stop. The malformed tail is
      // dropped from the user-visible text rather than printed verbatim.
      break;
    }
    const body = text.slice(open + TOOL_CALL_OPEN.length, close).trim();
    const parsed = tryParseToolCallBody(body);
    if (parsed) {
      calls.push({ id: `tc_${++n}`, name: parsed.name, input: parsed.arguments });
    }
    cursor = close + TOOL_CALL_CLOSE.length;
  }
  return { cleanedText: cleaned.trim(), toolCalls: calls };
}

function tryParseToolCallBody(body: string): { name: string; arguments: Record<string, unknown> } | null {
  // Be lenient: strip a JSON code fence if the model wraps the call.
  const stripped = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(stripped) as { name?: unknown; arguments?: unknown; parameters?: unknown };
    if (typeof obj.name !== 'string') return null;
    const args = (obj.arguments ?? obj.parameters ?? {}) as Record<string, unknown>;
    return { name: obj.name, arguments: typeof args === 'object' && args !== null ? args : {} };
  } catch {
    return null;
  }
}

/** Interrupt a generation in progress. Used by the chat panel's stop button. */
export async function interruptLocal(): Promise<void> {
  if (loaded?.engine?.interruptGenerate) {
    try { loaded.engine.interruptGenerate(); } catch { /* noop */ }
  }
}

/** Single-shot, non-streamed completion. Compaction uses it. */
export async function summarizeLocal(
  modelId: LocalModelId,
  system: string,
  user: string,
  maxTokens = 512,
): Promise<{ text: string; usage: TurnUsage }> {
  if (!loaded || loaded.modelId !== modelId) {
    throw new Error(`Local model ${modelId} is not loaded.`);
  }
  const { engine } = loaded;
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    max_tokens: maxTokens,
    temperature: 0.4,
  });
  const text = response?.choices?.[0]?.message?.content ?? '';
  return {
    text,
    usage: {
      inputTokens: response?.usage?.prompt_tokens ?? 0,
      outputTokens: response?.usage?.completion_tokens ?? 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

// === Anthropic-shape ↔ OpenAI-shape translation ===

function buildOpenAiTools(tools: ToolDefinition[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function buildLocalApiMessages(
  systemPrompt: string,
  systemSuffix: string,
  history: ChatMessage[],
  info: LocalModelInfo,
  native: boolean,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const sys = systemSuffix.trim().length > 0 ? `${systemPrompt}\n\n${systemSuffix}` : systemPrompt;
  out.push({ role: 'system', content: sys });

  for (const msg of history) {
    if (msg.role === 'user') {
      if (native) {
        // Native function-calling models expect one OpenAI "tool" message
        // per tool_call_id.
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const r of msg.toolResults) {
            out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
          }
        }
        const content = userBlocksToContent(msg.blocks, info);
        if (content !== null) out.push({ role: 'user', content });
      } else {
        // Prompt-engineered path: collapse tool results into a single user
        // turn the model can read as plain text.
        const parts: string[] = [];
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const r of msg.toolResults) {
            parts.push(`<tool_result${r.isError ? ' error="true"' : ''}>\n${r.content}\n</tool_result>`);
          }
        }
        const textContent = userBlocksToContent(msg.blocks, info);
        if (typeof textContent === 'string') parts.push(textContent);
        else if (Array.isArray(textContent)) {
          // Vision multipart: append the parts directly when supported.
          // Falls through below.
        }
        if (parts.length > 0) {
          if (Array.isArray(textContent)) {
            const merged: unknown[] = [...textContent, { type: 'text', text: parts.join('\n\n') }];
            out.push({ role: 'user', content: merged });
          } else {
            out.push({ role: 'user', content: parts.join('\n\n') });
          }
        } else if (Array.isArray(textContent)) {
          out.push({ role: 'user', content: textContent });
        }
      }
    } else {
      const content = assistantTextOf(msg.blocks);
      if (native) {
        const toolCalls = (msg.toolCalls ?? []).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
        const assistantMsg: Record<string, unknown> = { role: 'assistant' };
        if (content.length > 0) assistantMsg.content = content;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        if (content.length > 0 || toolCalls.length > 0) out.push(assistantMsg);
      } else {
        // Re-serialize prior tool calls in the same `<tool_call>` markup
        // the model is being trained on this turn — keeps the conversation
        // self-consistent.
        const parts: string[] = [];
        if (content.length > 0) parts.push(content);
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push(`${TOOL_CALL_OPEN}\n${JSON.stringify({ name: tc.name, arguments: tc.input ?? {} })}\n${TOOL_CALL_CLOSE}`);
          }
        }
        if (parts.length > 0) out.push({ role: 'assistant', content: parts.join('\n\n') });
      }
    }
  }
  return out;
}

function userBlocksToContent(blocks: ChatBlock[], info: LocalModelInfo): string | Array<unknown> | null {
  const textParts: string[] = [];
  const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text.trim().length > 0) textParts.push(b.text);
    } else if (b.type === 'image' && info.supportsVision) {
      imageParts.push({ type: 'image_url', image_url: { url: imageDataUrl(b.source) } });
    }
    // Non-vision models silently drop image blocks. The toggle-suffix in
    // systemPrompt.ts already tells the model it can't see views, so the
    // model shouldn't ask for them.
  }
  if (textParts.length === 0 && imageParts.length === 0) return null;
  if (imageParts.length === 0) return textParts.join('\n\n');
  // Mixed text+image — OpenAI multipart content array.
  const parts: unknown[] = imageParts;
  if (textParts.length > 0) parts.push({ type: 'text', text: textParts.join('\n\n') });
  return parts;
}

function assistantTextOf(blocks: ChatBlock[]): string {
  return blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
}

function imageDataUrl(source: ImageSource): string {
  return `data:${source.mediaType};base64,${source.data}`;
}
