// OpenAI provider: hand-rolled fetch, SSE streaming. No SDK dependency —
// keeps the bundle small and the wire format inspectable.
//
// The agent loop (streamTurn) talks to the **Responses API**
// (/v1/responses), not Chat Completions. Newer reasoning models — gpt-5.5
// and beyond — reject `reasoning_effort` alongside function tools on
// /v1/chat/completions ("Function tools with reasoning_effort are not
// supported … Please use /v1/responses instead"), and the agent always
// sends tools. Responses is OpenAI's forward path for reasoning models and
// supports every chat model too, so the whole loop runs through it.
//
// validateKey / listModels / summarize stay on Chat Completions: they send
// neither tools nor a reasoning request, so they're unaffected by that
// restriction and the simpler endpoint is fine.
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
 *  request; the 4o/4.1 chat models reject it. Sniff the id so we only ask
 *  for reasoning where it's valid. */
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
  /** Canonical history; converted to the Responses `input` shape internally. */
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  /** Extended-thinking level → reasoning `effort` (reasoning models only).
   *  'off' (default) omits the `reasoning` field. */
  thinking?: ChatToggles['thinking'];
}

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

export async function streamTurn(
  spec: OpenaiRequestSpec,
  callbacks: StreamCallbacks = {},
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
  // `reasoning.effort` only for reasoning models + non-'off' levels; 4o/4.1
  // and 'off' omit it so the request matches the provider default.
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

interface AccumulatedToolCall {
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
  const toolBuffers: Record<string, AccumulatedToolCall> = {};
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

function collectAssistantText(blocks: ChatBlock[]): string {
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text') text += b.text;
  }
  return text;
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

function imageToDataUrl(source: ImageSource): string {
  return `data:${source.mediaType};base64,${source.data}`;
}

/** Single-shot non-streaming call used by compaction + review. Stays on Chat
 *  Completions: no tools and no reasoning request, so the gpt-5.5 tools +
 *  reasoning_effort restriction doesn't apply. */
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
