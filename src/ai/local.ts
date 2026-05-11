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
 *  returned by anthropic.streamTurn so chatLoop can swap providers cleanly. */
export async function streamLocalTurn(spec: LocalRequestSpec, callbacks: StreamCallbacks = {}): Promise<StreamResult> {
  if (!loaded || loaded.modelId !== spec.modelId) {
    throw new Error(`Local model ${spec.modelId} is not loaded. Open AI settings → Local model to download it first.`);
  }
  const { engine, info } = loaded;
  const maxTokens = spec.maxTokens ?? 1024;

  const messages = buildLocalApiMessages(spec.systemPrompt, spec.systemSuffix, spec.history, info);
  const tools = buildOpenAiTools(spec.tools);

  // WebLLM's stream emits OpenAI-shape chunks. Tool call args arrive as a
  // running JSON string we accumulate across deltas, just like the official
  // OpenAI SDK.
  const stream = await engine.chat.completions.create({
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    temperature: 0.6,
  });

  let text = '';
  let stopReason = 'unknown';
  const toolBuf = new Map<number, { id: string; name: string; argsRaw: string; announced: boolean }>();
  const usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  for await (const chunk of stream as AsyncIterable<any>) {
    const choice = chunk?.choices?.[0];
    if (choice?.delta?.content) {
      const delta = choice.delta.content as string;
      text += delta;
      callbacks.onText?.(delta);
    }
    if (choice?.delta?.tool_calls) {
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

  const toolCalls: PersistedToolCall[] = [];
  for (const entry of toolBuf.values()) {
    if (!entry.name) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = entry.argsRaw.trim().length > 0 ? JSON.parse(entry.argsRaw) : {};
    } catch {
      // Schema-constrained decoding makes this rare but possible if the
      // model truncates mid-call. We pass the raw string back so the
      // executor can surface a useful "bad JSON" error to the model on
      // retry instead of silently dropping the call.
      parsed = { __raw: entry.argsRaw };
    }
    toolCalls.push({ id: entry.id, name: entry.name, input: parsed });
  }

  // Normalize finish_reason to match Anthropic vocabulary ("tool_use" /
  // "end_turn") so chatLoop's branching reads the same.
  let normStop = stopReason;
  if (toolCalls.length > 0) normStop = 'tool_use';
  else if (stopReason === 'stop') normStop = 'end_turn';
  else if (stopReason === 'length') normStop = 'max_tokens';

  return { text, toolCalls, stopReason: normStop, usage };
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
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const sys = systemSuffix.trim().length > 0 ? `${systemPrompt}\n\n${systemSuffix}` : systemPrompt;
  out.push({ role: 'system', content: sys });

  for (const msg of history) {
    if (msg.role === 'user') {
      // Tool results need to come back as one OpenAI "tool" message per
      // tool_call_id (not bundled in a user message).
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const r of msg.toolResults) {
          out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
        }
      }
      // User text + (vision-only) images.
      const content = userBlocksToContent(msg.blocks, info);
      if (content !== null) out.push({ role: 'user', content });
    } else {
      const content = assistantTextOf(msg.blocks);
      const toolCalls = (msg.toolCalls ?? []).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
      }));
      const assistantMsg: Record<string, unknown> = { role: 'assistant' };
      if (content.length > 0) assistantMsg.content = content;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      // OpenAI requires either content or tool_calls; skip if both empty.
      if (content.length > 0 || toolCalls.length > 0) out.push(assistantMsg);
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
