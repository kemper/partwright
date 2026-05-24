// OpenAI provider: hand-rolled fetch, SSE streaming. No SDK dependency —
// keeps the bundle small and the wire format inspectable.
//
// The agent loop (streamTurn) routes per model so we support the widest
// range of models, old and new:
//
//   - Reasoning models (gpt-5 family incl. gpt-5.5, o1/o3/o4) → the
//     **Responses API** (/v1/responses). gpt-5.5+ *reject* reasoning_effort
//     alongside function tools on /v1/chat/completions ("… Please use
//     /v1/responses instead") and the agent always sends tools, so reasoning
//     models go to Responses — their forward-looking home, which every
//     current reasoning model supports.
//   - Every other / older model (gpt-4o, gpt-4.1, and legacy gpt-4 /
//     gpt-4-turbo / gpt-3.5-turbo, dated snapshots) → **Chat Completions**
//     (/v1/chat/completions). Some of these exist *only* on Chat Completions
//     (they're not on the Responses API), so keeping them here is what makes
//     "slightly older models" keep working.
//
// The split is gated by isReasoningModel — the same sniff that decides
// whether a reasoning request is even valid — so there's no brittle
// version-number guessing.
//
// validateKey / listModels / summarize stay on Chat Completions: they send
// neither tools nor a reasoning request, so the Responses-only restriction
// never applies and the simpler endpoint works for every model.
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

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** OpenAI reasoning models (gpt-5 family + the o-series) accept a reasoning
 *  request; the 4o/4.1 and legacy chat models reject it. This same sniff
 *  also routes the request: reasoning models go to the Responses API,
 *  everything else to Chat Completions. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
}

/** Map the shared thinking level to OpenAI's reasoning `effort`. 'off'
 *  returns null so the `reasoning` field is omitted entirely — leaving the
 *  provider default in place. 'low'/'medium'/'high' map straight through
 *  (all three are valid effort values on every reasoning model).
 *  Non-reasoning models always return null. Note: OpenAI hides
 *  reasoning-model chain-of-thought, so this controls cost/quality but
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
    const res = await fetch(CHAT_URL, {
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
  /** Canonical history; converted to the per-endpoint shape internally. */
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  /** Extended-thinking level → reasoning `effort` (reasoning models only).
   *  'off' (default) omits the reasoning request. */
  thinking?: ChatToggles['thinking'];
}

/** Route per model: reasoning models go to the Responses API (gpt-5.5+
 *  require it for tools + reasoning), everything else to Chat Completions
 *  (where the older / legacy models live). */
export async function streamTurn(
  spec: OpenaiRequestSpec,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  return isReasoningModel(spec.model)
    ? streamTurnResponses(spec, callbacks, signal)
    : streamTurnChat(spec, callbacks, signal);
}

// ---------------------------------------------------------------------------
// Responses API path (reasoning models: gpt-5 family, o-series)
// ---------------------------------------------------------------------------

/** Responses API tool definition — flatter than Chat Completions (no nested
 *  `function` wrapper). */
interface ResponsesToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string };

type ResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: ResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

async function streamTurnResponses(
  spec: OpenaiRequestSpec,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const maxOutputTokens = spec.maxTokens ?? 8192;

  const tools: ResponsesToolDef[] = spec.tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));

  // The system prompt rides in `instructions`. We merge our long prompt +
  // suffix because the Responses API takes a single instructions string.
  const instructions = spec.systemSuffix.trim().length > 0
    ? `${spec.systemPrompt}\n\n${spec.systemSuffix}`
    : spec.systemPrompt;

  const input = buildResponsesInput(spec.history);

  const body: Record<string, unknown> = {
    model: spec.model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    stream: true,
    // We keep our own transcript and resend the full history each turn, so
    // there's no reason to have OpenAI persist the response server-side.
    store: false,
  };
  if (tools.length > 0) body.tools = tools;
  // `reasoning.effort` only for non-'off' levels (every model routed here is
  // a reasoning model).
  const effort = reasoningEffort(spec.model, spec.thinking ?? 'off');
  if (effort) body.reasoning = { effort };

  let res: Response;
  try {
    res = await fetch(RESPONSES_URL, {
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

  return await consumeResponsesStream(res, callbacks, signal);
}

interface ResponsesToolBuffer {
  callId: string;
  name: string;
  argsText: string;
  startedNotified: boolean;
}

async function consumeResponsesStream(
  res: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let collectedText = '';
  // Keyed by the streamed output-item id so argument deltas land in the
  // right buffer; toolOrder preserves emission order for the final array.
  const toolBuffers: Record<string, ResponsesToolBuffer> = {};
  const toolOrder: string[] = [];
  let stopReason = 'end_turn';
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

  try {
    for await (const event of readSseStream(res, signal)) {
      // The Responses stream ends by closing the body after
      // `response.completed`; there's no `[DONE]` sentinel to watch for.
      let payload: any;
      try { payload = JSON.parse(event); } catch { continue; }
      const type: string = payload.type ?? '';

      if (type === 'response.output_text.delta') {
        const delta: string = typeof payload.delta === 'string' ? payload.delta : '';
        if (delta.length > 0) {
          collectedText += delta;
          callbacks.onText?.(delta);
        }
      } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = payload.item;
        if (item && item.type === 'function_call') {
          const key: string = item.id ?? `item_${payload.output_index ?? toolOrder.length}`;
          let buf = toolBuffers[key];
          if (!buf) {
            buf = {
              callId: item.call_id ?? key,
              name: item.name ?? '',
              argsText: typeof item.arguments === 'string' ? item.arguments : '',
              startedNotified: false,
            };
            toolBuffers[key] = buf;
            toolOrder.push(key);
          }
          if (typeof item.call_id === 'string' && item.call_id.length > 0) buf.callId = item.call_id;
          if (item.name && !buf.name) buf.name = item.name;
          // The `done` item carries the complete arguments string.
          if (type === 'response.output_item.done' && typeof item.arguments === 'string') {
            buf.argsText = item.arguments;
          }
          if (!buf.startedNotified && buf.name) {
            buf.startedNotified = true;
            callbacks.onToolStart?.(buf.callId, buf.name);
          }
        }
      } else if (type === 'response.function_call_arguments.delta') {
        const key: string = payload.item_id ?? '';
        const buf = toolBuffers[key];
        if (buf && typeof payload.delta === 'string') buf.argsText += payload.delta;
      } else if (type === 'response.function_call_arguments.done') {
        const key: string = payload.item_id ?? '';
        const buf = toolBuffers[key];
        if (buf && typeof payload.arguments === 'string') buf.argsText = payload.arguments;
      } else if (type === 'response.completed' || type === 'response.incomplete') {
        const response = payload.response ?? {};
        if (response.usage) {
          usage = {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
            cacheCreationInputTokens: 0,
            // Responses exposes cached prompt tokens via
            // input_tokens_details.cached_tokens — treat as cache reads so
            // cost.ts can discount them.
            cacheReadInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
          };
        }
        if (type === 'response.incomplete') {
          const reason = response.incomplete_details?.reason;
          stopReason = reason === 'max_output_tokens' ? 'max_tokens' : 'incomplete';
        }
      } else if (type === 'response.failed') {
        const message = payload.response?.error?.message ?? 'response failed';
        throw new Error(`OpenAI: ${message}`);
      } else if (type === 'error') {
        const message = payload.message ?? payload.error?.message ?? 'stream error';
        throw new Error(`OpenAI: ${message}`);
      }
    }
  } catch (err) {
    if (signal?.aborted) return { text: collectedText, toolCalls: [], stopReason: 'aborted', usage };
    throw err;
  }

  const toolCalls: PersistedToolCall[] = toolOrder.map(key => {
    const buf = toolBuffers[key];
    return { id: buf.callId, name: buf.name, input: parseToolArgs(buf.argsText) };
  });
  // chatLoop continues the agent loop only when stopReason is 'tool_use'
  // AND there are calls, so flag it whenever the model asked for a tool.
  if (toolCalls.length > 0) stopReason = 'tool_use';

  return { text: collectedText, toolCalls, stopReason, usage };
}

/** Convert the canonical chat history into the Responses `input` array. The
 *  Responses API takes a flat list of items: `message` items (user/assistant
 *  text + images), `function_call` items (the model's tool calls), and
 *  `function_call_output` items (tool results), all linked by `call_id`. */
function buildResponsesInput(history: ChatMessage[]): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const msg of history) {
    if (msg.role === 'assistant') {
      const text = collectAssistantText(msg.blocks);
      if (text.length > 0) {
        out.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
      }
      for (const tc of msg.toolCalls ?? []) {
        out.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.input ?? {}),
        });
      }
    } else {
      // Tool results come BEFORE any new user text, mirroring the order the
      // model emitted the calls.
      for (const r of msg.toolResults ?? []) {
        out.push({ type: 'function_call_output', call_id: r.toolUseId, output: r.content });
        if (r.image) {
          // function_call_output takes a string `output`, so surface the
          // image on a following user message.
          out.push({
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: `(tool result image for ${r.toolUseId})` },
              { type: 'input_image', image_url: imageToDataUrl(r.image) },
            ],
          });
        }
      }
      const content = buildResponsesUserContent(msg.blocks);
      if (content) out.push({ type: 'message', role: 'user', content });
    }
  }
  return sanitizeResponsesToolCalls(out);
}

/** The Responses API 400s if a `function_call` item has no matching
 *  `function_call_output` ("No tool output found for function call …"). A
 *  turn that ends right after the model emits tool calls — user Stop, stall
 *  watchdog, or the spend cap tripping before results post — leaves a
 *  dangling call in history, so the next send fails. Mirror the Chat
 *  Completions / Anthropic repair: inject a synthetic error output for any
 *  unanswered call_id. Keyed off the GLOBAL set of answered ids so an image
 *  tool-result — surfaced on a `user` message wedged between items — doesn't
 *  read as a gap. */
function sanitizeResponsesToolCalls(items: ResponsesInputItem[]): ResponsesInputItem[] {
  const answered = new Set<string>();
  for (const it of items) {
    if (it.type === 'function_call_output') answered.add(it.call_id);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type !== 'function_call' || answered.has(it.call_id)) continue;
    const synthetic: ResponsesInputItem = {
      type: 'function_call_output',
      call_id: it.call_id,
      output: 'Tool call was interrupted and did not complete.',
    };
    items.splice(i + 1, 0, synthetic);
    answered.add(it.call_id);
    i += 1;
  }
  return items;
}

function buildResponsesUserContent(blocks: ChatBlock[]): ResponsesContentPart[] | null {
  const items: ResponsesContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text.trim().length > 0) {
      items.push({ type: 'input_text', text: b.text });
    } else if (b.type === 'image') {
      items.push({ type: 'input_image', image_url: imageToDataUrl(b.source) });
    } else if (b.type === 'review') {
      // Reviews from other providers serialize to text so any model can
      // see them. Tag stays so the receiving model can tell it apart.
      items.push({ type: 'input_text', text: `[Review from ${b.provider}/${b.model}]\n${b.text}` });
    }
  }
  return items.length > 0 ? items : null;
}

// ---------------------------------------------------------------------------
// Chat Completions path (gpt-4o / gpt-4.1 + legacy gpt-4 / gpt-3.5-turbo)
// ---------------------------------------------------------------------------

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

async function streamTurnChat(
  spec: OpenaiRequestSpec,
  callbacks: StreamCallbacks,
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
  messages.push(...buildChatMessages(spec.history));

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
  // Non-reasoning models route here, so reasoningEffort() returns null and no
  // reasoning_effort is sent — exactly the pre-feature request shape. (A
  // reasoning model would have been dispatched to the Responses path.)
  const effort = reasoningEffort(spec.model, spec.thinking ?? 'off');
  if (effort) body.reasoning_effort = effort;

  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
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

  return await consumeChatStream(res, callbacks, signal);
}

interface ChatToolBuffer {
  id: string;
  name: string;
  argsText: string;
  startedNotified: boolean;
}

async function consumeChatStream(
  res: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let collectedText = '';
  const toolBuffers: Record<number, ChatToolBuffer> = {};
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
      if (choice.finish_reason) stopReason = mapChatStopReason(choice.finish_reason);
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

function mapChatStopReason(reason: string): string {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return reason;
}

function buildChatMessages(history: ChatMessage[]): OpenAIMessage[] {
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
      const content = buildChatUserContent(msg.blocks);
      if (content !== null) out.push({ role: 'user', content });
    }
  }
  return sanitizeChatToolMessages(out);
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
function sanitizeChatToolMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
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

function buildChatUserContent(blocks: ChatBlock[]): OpenAIMessage['content'] | null {
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function collectAssistantText(blocks: ChatBlock[]): string {
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text') text += b.text;
  }
  return text;
}

function imageToDataUrl(source: ImageSource): string {
  return `data:${source.mediaType};base64,${source.data}`;
}

/** Single-shot non-streaming call used by compaction + review. Stays on Chat
 *  Completions: no tools and no reasoning request, so the gpt-5.5 tools +
 *  reasoning_effort restriction doesn't apply and every model works here. */
export async function summarize(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens = 4096,
): Promise<{ text: string; usage: TurnUsage }> {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      model,
      // Newer OpenAI models require max_completion_tokens (they 400 on
      // max_tokens); it's forward-compatible for the 4o/4.1 models too.
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
