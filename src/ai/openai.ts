// OpenAI provider: hand-rolled fetch against the Chat Completions API,
// SSE streaming. No SDK dependency — keeps the bundle small and the
// wire format inspectable.
//
// Mirrors src/ai/anthropic.ts's exported shape (validateKey, streamTurn,
// summarize, resetClient) so chatLoop.ts can dispatch via a sibling
// branch without learning a new interface.

import type {
  ChatBlock,
  ChatMessage,
  ChatToggles,
  ImageSource,
  PersistedToolCall,
  ThinkingBlockData,
  TurnUsage,
} from './types';
import type { ToolDefinition } from './tools';
import { readSseStream } from './sse';

const API_URL = 'https://api.openai.com/v1/chat/completions';

/** OpenAI reasoning models (gpt-5 family + the o-series) accept the
 *  `reasoning_effort` param; the 4o/4.1 chat models reject it with a 400
 *  `unsupported_parameter`. Sniff the id so we only send it where it's
 *  valid. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
}

/** Map the shared thinking level to OpenAI `reasoning_effort`. 'off' returns
 *  null so the param is omitted entirely — leaving the provider default in
 *  place, i.e. byte-identical to the pre-feature request. 'low'/'medium'/
 *  'high' map straight through (all three are valid effort values on every
 *  reasoning model). Non-reasoning models always return null. Note: OpenAI
 *  hides reasoning-model chain-of-thought, so this controls cost/quality but
 *  never surfaces a thinking box. */
function reasoningEffort(model: string, level: ChatToggles['thinking']): string | null {
  if (level === 'off' || !isReasoningModel(model)) return null;
  return level;
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export function resetClient(): void {
  // Stateless — each request opens its own fetch.
}

/** Validate a key by issuing the cheapest possible request. */
export async function validateKey(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_completion_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });
    if (res.ok) return null;
    if (res.status === 401) return 'Invalid API key.';
    const body = await res.text().catch(() => '');
    const snippet = body.slice(0, 200) || 'no body';
    return `${res.status}: ${snippet}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Fetch the chat-capable models this key can use. OpenAI's /v1/models
 *  endpoint returns everything (embeddings, audio, image, moderation…), so
 *  we filter to the gpt-/o-series chat families and drop the non-chat
 *  variants. Mirrors the Gemini/Anthropic helpers so the settings modal can
 *  offer "Load models from your key" for every hosted provider. Throws on a
 *  non-OK response. */
export async function listModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid API key.');
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as { data?: Array<{ id?: string }> };
  const out: { id: string; label: string }[] = [];
  for (const m of data.data ?? []) {
    if (!m.id) continue;
    if (!/^(gpt-|o1|o3|o4|chatgpt)/i.test(m.id)) continue;
    // Drop non-chat variants that share the gpt- prefix.
    if (/embedding|whisper|tts|audio|dall-e|image|moderation|realtime|transcribe/i.test(m.id)) continue;
    out.push({ id: m.id, label: m.id });
  }
  out.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  return out;
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
  /** Reasoning text if surfaced. Unused for OpenAI (reasoning models hide
   *  their chain of thought); present so chatLoop reads `result.thinking`
   *  uniformly across providers. */
  thinking?: string;
  /** Anthropic-only thinking-block replay payload — always undefined here.
   *  Declared so chatLoop can read `result.thinkingBlocks` across the
   *  provider union without a cast. */
  thinkingBlocks?: ThinkingBlockData[];
}

export interface OpenaiRequestSpec {
  apiKey: string;
  model: string;
  systemPrompt: string;
  systemSuffix: string;
  /** Canonical history; converted to OpenAI message shape internally. */
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  /** Extended-thinking level → `reasoning_effort` (reasoning models only).
   *  'off' (default) omits the param. */
  thinking?: ChatToggles['thinking'];
}

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export async function streamTurn(
  spec: OpenaiRequestSpec,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  const maxCompletionTokens = spec.maxTokens ?? 8192;

  const tools: OpenAIToolDef[] = spec.tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // OpenAI takes the system as the first message in the messages array.
  // We merge our long prompt + suffix because OpenAI doesn't have a
  // separate cache breakpoint we can pin the suffix outside of.
  const systemText = spec.systemSuffix.trim().length > 0
    ? `${spec.systemPrompt}\n\n${spec.systemSuffix}`
    : spec.systemPrompt;

  const messages: OpenAIMessage[] = [{ role: 'system', content: systemText }];
  messages.push(...buildOpenaiMessages(spec.history));

  const body: Record<string, unknown> = {
    model: spec.model,
    // `max_completion_tokens`, not `max_tokens` — the gpt-5 family and the
    // o-series reject `max_tokens` outright (400 unsupported_parameter),
    // and it's the forward-compatible spelling for the older 4o/4.1 models
    // too. Don't switch this back.
    max_completion_tokens: maxCompletionTokens,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools.length > 0) body.tools = tools;
  // reasoning_effort only for reasoning models + non-'off' levels; otherwise
  // omitted so the request matches the pre-feature shape (and 4o/4.1 don't
  // 400 on an unsupported param).
  const effort = reasoningEffort(spec.model, spec.thinking ?? 'off');
  if (effort) body.reasoning_effort = effort;

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(spec.apiKey),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Abort (stall watchdog / user Stop) rejects the fetch — return a
    // clean aborted result rather than throwing the raw DOMException.
    if (signal?.aborted) return abortedResult();
    throw err;
  }

  if (!res.ok) {
    if (signal?.aborted) return abortedResult();
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 400) || res.statusText}`);
  }

  return await consumeOpenaiStream(res, callbacks, signal);
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  argsText: string;
  startedNotified: boolean;
}

async function consumeOpenaiStream(
  res: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let collectedText = '';
  const toolBuffers: Record<number, AccumulatedToolCall> = {};
  let stopReason = 'unknown';
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

  try {
    for await (const event of readSseStream(res, signal)) {
      if (event === '[DONE]') break;
      let payload: any;
      try { payload = JSON.parse(event); } catch { continue; }
      // Usage frame comes at the end when stream_options.include_usage=true.
      if (payload.usage) {
        usage = {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
          cacheCreationInputTokens: 0,
          // OpenAI exposes cached tokens via prompt_tokens_details.cached_tokens
          // — treat as cache reads so cost.ts can discount them.
          cacheReadInputTokens: payload.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
      const choice = payload.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        collectedText += delta.content;
        callbacks.onText?.(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          let buf = toolBuffers[idx];
          if (!buf) {
            buf = { id: tc.id ?? `call_${idx}`, name: '', argsText: '', startedNotified: false };
            toolBuffers[idx] = buf;
          }
          if (typeof tc.id === 'string' && tc.id.length > 0) buf.id = tc.id;
          if (tc.function?.name && !buf.name) buf.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string') buf.argsText += tc.function.arguments;
          if (!buf.startedNotified && buf.name) {
            buf.startedNotified = true;
            callbacks.onToolStart?.(buf.id, buf.name);
          }
        }
      }
      if (choice.finish_reason) stopReason = mapStopReason(choice.finish_reason);
    }
  } catch (err) {
    if (signal?.aborted) return { text: collectedText, toolCalls: [], stopReason: 'aborted', usage };
    throw err;
  }

  const toolCalls: PersistedToolCall[] = Object.values(toolBuffers).map(buf => ({
    id: buf.id,
    name: buf.name,
    input: parseToolArgs(buf.argsText),
  }));

  return { text: collectedText, toolCalls, stopReason, usage };
}

function abortedResult(): StreamResult {
  return {
    text: '',
    toolCalls: [],
    stopReason: 'aborted',
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

function parseToolArgs(argsText: string): Record<string, unknown> {
  if (!argsText) return {};
  try {
    const parsed = JSON.parse(argsText);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function mapStopReason(reason: string): string {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return reason;
}

function buildOpenaiMessages(history: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const msg of history) {
    if (msg.role === 'assistant') {
      const text = collectAssistantText(msg.blocks);
      const calls = msg.toolCalls ?? [];
      const am: OpenAIMessage = { role: 'assistant' };
      if (text.length > 0) am.content = text;
      if (calls.length > 0) {
        am.tool_calls = calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
      }
      if (am.content || am.tool_calls) out.push(am);
    } else {
      // Tool results come BEFORE any new user text per OpenAI's rules.
      for (const r of msg.toolResults ?? []) {
        out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
        if (r.image) {
          // OpenAI's tool role doesn't accept image blocks directly, so we
          // surface the image on a user message right after.
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: `(tool result image for ${r.toolUseId})` },
              { type: 'image_url', image_url: { url: imageToDataUrl(r.image) } },
            ],
          });
        }
      }
      const content = buildUserContent(msg.blocks);
      if (content !== null) out.push({ role: 'user', content });
    }
  }
  return sanitizeOpenaiToolMessages(out);
}

/** OpenAI 400s if an assistant message carrying `tool_calls` isn't followed
 *  by a `tool` message for every tool_call_id before the next turn ("The
 *  following tool_call_ids did not have response messages"). A turn that
 *  ends right after the model emits tool calls — user Stop, stall watchdog,
 *  or the spend cap tripping before results are posted — leaves a dangling
 *  assistant message in history, so the next send fails.
 *
 *  Mirror anthropic.ts's `sanitizeToolUse`: inject a synthetic error result
 *  for any unanswered id. Keyed off the GLOBAL set of answered ids (not a
 *  positional scan) so an image tool-result — which surfaces the image on a
 *  `user` message wedged between `tool` messages — doesn't read as a gap. */
function sanitizeOpenaiToolMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) answered.add(m.tool_call_id);
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue;
    const missing = m.tool_calls.filter(tc => !answered.has(tc.id));
    if (missing.length === 0) continue;
    const synthetic: OpenAIMessage[] = missing.map(tc => ({
      role: 'tool',
      tool_call_id: tc.id,
      content: 'Tool call was interrupted and did not complete.',
    }));
    messages.splice(i + 1, 0, ...synthetic);
    for (const s of synthetic) if (s.tool_call_id) answered.add(s.tool_call_id);
    i += synthetic.length;
  }
  return messages;
}

function collectAssistantText(blocks: ChatBlock[]): string {
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text') text += b.text;
  }
  return text;
}

function buildUserContent(blocks: ChatBlock[]): OpenAIMessage['content'] | null {
  // String content is preferred when there are no images — keeps the
  // payload small and matches the most common case.
  const hasImage = blocks.some(b => b.type === 'image');
  const items: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  let plainText = '';
  for (const b of blocks) {
    if (b.type === 'text' && b.text.trim().length > 0) {
      if (hasImage) items.push({ type: 'text', text: b.text });
      else plainText += b.text;
    } else if (b.type === 'image') {
      items.push({ type: 'image_url', image_url: { url: imageToDataUrl(b.source) } });
    } else if (b.type === 'review') {
      // Reviews from other providers serialize to text so any model can
      // see them. Tag stays so the receiving model can tell it apart.
      const reviewText = `[Review from ${b.provider}/${b.model}]\n${b.text}`;
      if (hasImage) items.push({ type: 'text', text: reviewText });
      else plainText += reviewText;
    }
  }
  if (!hasImage) return plainText.length > 0 ? plainText : null;
  return items.length > 0 ? items : null;
}

function imageToDataUrl(source: ImageSource): string {
  return `data:${source.mediaType};base64,${source.data}`;
}

/** Single-shot non-streaming call used by compaction + review. */
export async function summarize(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens = 4096,
): Promise<{ text: string; usage: TurnUsage }> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      model,
      // See streamTurn — newer OpenAI models require max_completion_tokens.
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 400) || res.statusText}`);
  }
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  const usage: TurnUsage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
  return { text, usage };
}

