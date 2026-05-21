// Google Gemini provider: hand-rolled fetch against the v1beta
// generativelanguage REST API, SSE streaming via `:streamGenerateContent?alt=sse`.
// No SDK dependency. Mirrors src/ai/anthropic.ts's exported shape so
// chatLoop.ts can dispatch via a sibling branch.

import type {
  ChatMessage,
  PersistedToolCall,
  TurnUsage,
} from './types';
import type { ToolDefinition } from './tools';
import { readSseStream } from './sse';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function streamUrl(model: string, apiKey: string): string {
  return `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

function generateUrl(model: string, apiKey: string): string {
  return `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export function resetClient(): void {
  // Stateless.
}

export async function validateKey(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(generateUrl('gemini-2.5-flash-lite', apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    if (res.ok) return null;
    const text = await res.text().catch(() => '');
    if ((res.status === 400 || res.status === 401 || res.status === 403)
        && /api[ _]key|unauthorized|forbidden|invalid/i.test(text)) {
      return 'Invalid API key.';
    }
    return `${res.status}: ${text.slice(0, 200) || res.statusText}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Fetch the models this key can actually use, filtered to those that
 *  support generateContent. Model ids rev fast and vary by key tier — a
 *  hard-coded list goes stale and 404s (which is exactly what happened
 *  with guessed Gemini 3 ids). The settings modal calls this so the user
 *  picks from their real current lineup, including newer models like
 *  Gemini 3 / "Nano Banana" with whatever id Google actually assigned. */
export async function listModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const res = await fetch(`${API_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as {
    models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  const out: { id: string; label: string }[] = [];
  for (const m of data.models ?? []) {
    if (!m.name) continue;
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
    const id = m.name.replace(/^models\//, '');
    // Skip legacy embedding / aqa / non-chat families that slip through.
    if (/embedding|aqa|imagen/i.test(id)) continue;
    out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id });
  }
  // Newest-ish first: 3.x before 2.5 before 1.5, then alpha.
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
}

export interface GeminiRequestSpec {
  apiKey: string;
  model: string;
  systemPrompt: string;
  systemSuffix: string;
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

interface GeminiToolDef {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Gemini 3+ thinking models attach this to functionCall (and some
   *  text) parts. Must be echoed back verbatim on the next request. */
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export async function streamTurn(
  spec: GeminiRequestSpec,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  const max_tokens = spec.maxTokens ?? 8192;

  const tools: GeminiToolDef[] = spec.tools.length > 0
    ? [{ functionDeclarations: spec.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeSchemaForGemini(t.input_schema),
      })) }]
    : [];

  const systemText = spec.systemSuffix.trim().length > 0
    ? `${spec.systemPrompt}\n\n${spec.systemSuffix}`
    : spec.systemPrompt;

  const body: Record<string, unknown> = {
    contents: buildGeminiContents(spec.history),
    generationConfig: { maxOutputTokens: max_tokens },
    // systemInstruction takes `parts` only — adding `role` makes some
    // server-side validators silently drop the instruction.
    systemInstruction: { parts: [{ text: systemText }] },
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(streamUrl(spec.model, spec.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    if (signal?.aborted) return abortedResult();
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400) || res.statusText}`);
  }

  return await consumeGeminiStream(res, callbacks, signal);
}

async function consumeGeminiStream(
  res: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let collectedText = '';
  const toolCalls: PersistedToolCall[] = [];
  let stopReason = 'unknown';
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  let toolIndex = 0;
  let promptBlockReason: string | undefined;

  try {
    for await (const event of readSseStream(res, signal)) {
      let payload: any;
      try { payload = JSON.parse(event); } catch { continue; }
      // Gemini can ship a 200 with an inline error frame mid-stream.
      // Surface it verbatim instead of silently dropping the event and
      // ending with stopReason='unknown'.
      if (payload.error) {
        const code = payload.error.code ?? '?';
        const status = payload.error.status ?? '';
        const msg = payload.error.message ?? '(no message)';
        throw new Error(`Gemini ${code}${status ? ` ${status}` : ''}: ${msg}`);
      }
      if (payload.usageMetadata) {
        usage = {
          inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
          outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: payload.usageMetadata.cachedContentTokenCount ?? 0,
        };
      }
      if (payload.promptFeedback?.blockReason) {
        promptBlockReason = payload.promptFeedback.blockReason;
      }
      const candidate = payload.candidates?.[0];
      if (!candidate) continue;
      const parts: GeminiPart[] = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          collectedText += part.text;
          callbacks.onText?.(part.text);
        } else if (part.functionCall) {
          const id = `gemini_call_${toolIndex++}`;
          callbacks.onToolStart?.(id, part.functionCall.name);
          toolCalls.push({
            id,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
            // Preserve the thought signature so we can replay it on the
            // next request — Gemini 3 rejects the turn otherwise.
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          });
        }
      }
      if (candidate.finishReason) {
        stopReason = mapStopReason(candidate.finishReason);
      }
    }
  } catch (err) {
    if (signal?.aborted) return { text: collectedText, toolCalls: [], stopReason: 'aborted', usage };
    throw err;
  }

  if (toolCalls.length > 0) {
    // Gemini reports finishReason=STOP even when emitting function calls.
    stopReason = 'tool_use';
  } else if (promptBlockReason) {
    throw new Error(`Gemini refused: prompt blocked (${promptBlockReason}). Check the input or relax safety settings in AI Studio.`);
  } else if (stopReason === 'unknown') {
    // No candidates and no error frame. Most often legitimate "model has
    // nothing to add" after a tool round-trip; could also be invalid
    // model id or rejected tool schema. Soft-fail so the chat continues
    // — diagnostics records the empty response, the panel surfaces
    // "model exited without a final message", and the user can open
    // 🩺 Diagnostics to see what came back.
    stopReason = 'end_turn';
  }
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

function mapStopReason(reason: string): string {
  if (reason === 'STOP') return 'end_turn';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'BLOCKLIST') return 'refusal';
  return reason.toLowerCase();
}

function buildGeminiContents(history: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const msg of history) {
    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];
      for (const b of msg.blocks) {
        if (b.type === 'text' && b.text.length > 0) parts.push({ text: b.text });
      }
      for (const tc of msg.toolCalls ?? []) {
        const fcPart: GeminiPart = { functionCall: { name: tc.name, args: tc.input ?? {} } };
        // Echo the thought signature Gemini 3 handed us with this call;
        // the API 400s if a functionCall part comes back without it.
        if (tc.thoughtSignature) fcPart.thoughtSignature = tc.thoughtSignature;
        parts.push(fcPart);
      }
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else {
      // Tool results first, on a user-role message with functionResponse
      // parts. `response` must be a plain object — Gemini's validator
      // silently drops the message (returning a 200 with empty
      // candidates on the NEXT turn) when it receives a string-wrapped
      // scalar. Most Partwright tools return JSON objects, so we parse
      // and pass through; non-object returns get a {result} envelope.
      const parts: GeminiPart[] = [];
      for (const r of msg.toolResults ?? []) {
        const name = recoverToolNameFromHistory(history, r.toolUseId) ?? 'unknown_tool';
        const response = toFunctionResponseObject(r.content, r.isError === true);
        parts.push({ functionResponse: { name, response } });
        if (r.image) {
          parts.push({ inlineData: { mimeType: r.image.mediaType, data: r.image.data } });
        }
      }
      for (const b of msg.blocks) {
        if (b.type === 'text' && b.text.trim().length > 0) parts.push({ text: b.text });
        else if (b.type === 'image') parts.push({ inlineData: { mimeType: b.source.mediaType, data: b.source.data } });
        else if (b.type === 'review') parts.push({ text: `[Review from ${b.provider}/${b.model}]\n${b.text}` });
      }
      if (parts.length > 0) out.push({ role: 'user', parts });
    }
  }
  return out;
}

function toFunctionResponseObject(content: string, isError: boolean): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { parsed = content; }
  let response: Record<string, unknown>;
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    response = { ...(parsed as Record<string, unknown>) };
  } else {
    response = { result: parsed };
  }
  if (isError) {
    response.error = true;
    if (typeof parsed === 'string' && !response.errorMessage) {
      response.errorMessage = parsed;
    }
  }
  return response;
}

/** Gemini's functionResponse parts identify themselves by tool NAME, not
 *  by id. To round-trip, look up the call's name from the preceding
 *  assistant turn. */
function recoverToolNameFromHistory(history: ChatMessage[], callId: string): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    const call = (msg.toolCalls ?? []).find(c => c.id === callId);
    if (call) return call.name;
  }
  return null;
}

interface ToolDefinitionSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  description?: string;
  [k: string]: unknown;
}

/** Gemini's OpenAPI subset rejects schemas that Anthropic/OpenAI happily
 *  accept. Three failure modes show up against the Partwright tool list:
 *    - `additionalProperties` / `$schema` (Gemini doesn't understand)
 *    - object types with no `properties` key (e.g. `withinBox: {type:
 *      object, description: ...}`) — Gemini rejects the whole tool list
 *      with 400 INVALID_ARGUMENT
 *    - schema entries with no `type` at all — Gemini treats this as
 *      missing-required-field and fails
 *
 *  Patched defensively so swapping providers doesn't require rewriting
 *  tool defs. Unknown `type` falls back to "string" — the loosest
 *  Gemini accepts as a function param. */
function sanitizeSchemaForGemini(schema: ToolDefinitionSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (key === '$schema' || key === 'additionalProperties') continue;
    if (key === 'properties' && val && typeof val === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(val)) {
        props[pk] = pv && typeof pv === 'object' && !Array.isArray(pv)
          ? sanitizeSchemaForGemini(pv as ToolDefinitionSchema)
          : pv;
      }
      result[key] = props;
    } else if (key === 'items' && val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = sanitizeSchemaForGemini(val as ToolDefinitionSchema);
    } else {
      result[key] = val;
    }
  }
  if (!result.type) {
    if (result.properties) result.type = 'object';
    else if (result.items) result.type = 'array';
    else if (result.enum) result.type = 'string';
    else result.type = 'string';
  }
  if (result.type === 'object' && !result.properties) {
    result.properties = {};
  }
  return result;
}

/** Single-shot non-streaming call used by compaction + review. */
export async function summarize(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens = 4096,
): Promise<{ text: string; usage: TurnUsage }> {
  const res = await fetch(generateUrl(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
      systemInstruction: { parts: [{ text: system }] },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400) || res.statusText}`);
  }
  const data = await res.json();
  const parts: GeminiPart[] = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => typeof p.text === 'string').map(p => p.text!).join('');
  const usage: TurnUsage = {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
  };
  return { text, usage };
}

