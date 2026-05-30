// Custom provider: a generic OpenAI-compatible HTTP endpoint the user points
// us at — typically a self-hosted server like llama.cpp's `llama-server`,
// vLLM, LM Studio, or Ollama's OpenAI-compatible shim. The wire format is
// identical to OpenAI's Chat Completions API, so the streaming transport,
// history conversion, tool schema, image handling, and dangling-tool-call
// repair are all reused verbatim from src/ai/openai.ts — this module only
// supplies the endpoint base URL and pins the Chat Completions path.
//
// Two things differ from the OpenAI provider proper:
//   1. Auth is OPTIONAL. A home server often runs with no `--api-key`, so the
//      Authorization header is omitted when no key is stored (handled by
//      openai.ts's authHeaders).
//   2. We never touch the Responses API (`/v1/responses`) — it's OpenAI-
//      proprietary and self-hosted servers don't implement it. `streamTurn`
//      passes `forceChatCompletions: true`, and we send `thinking: 'off'` so
//      no `reasoning_effort` field is ever attached (arbitrary servers reject
//      unknown fields).
//
// Mirrors the exported shape of the other providers (streamTurn / summarize /
// validateKey / listModels / resetClient) so chatLoop.ts, compaction.ts, and
// review.ts can dispatch via a sibling branch.

import {
  streamTurn as openaiStreamTurn,
  summarize as openaiSummarize,
  type StreamCallbacks,
  type StreamResult,
} from './openai';
import type { ChatMessage, TurnUsage } from './types';
import type { ToolDefinition } from './tools';

export type { StreamCallbacks, StreamResult } from './openai';

export interface CustomRequestSpec {
  /** Optional — empty string means "no auth header". */
  apiKey: string;
  /** Base URL including any version path, e.g. http://localhost:8080/v1 */
  baseUrl: string;
  model: string;
  systemPrompt: string;
  systemSuffix: string;
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

/** Build the `/models` URL for the configured base. Trailing slash tolerated. */
function modelsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/models`;
}

function authHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (apiKey && apiKey.trim().length > 0) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  return headers;
}

export function resetClient(): void {
  // Stateless — each request opens its own fetch.
}

export async function streamTurn(
  spec: CustomRequestSpec,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  return openaiStreamTurn(
    {
      apiKey: spec.apiKey,
      model: spec.model,
      systemPrompt: spec.systemPrompt,
      systemSuffix: spec.systemSuffix,
      history: spec.history,
      tools: spec.tools,
      maxTokens: spec.maxTokens,
      // Self-hosted servers implement Chat Completions, not the Responses
      // API; never send a reasoning request (see module header).
      thinking: 'off',
      baseUrl: spec.baseUrl,
      forceChatCompletions: true,
    },
    callbacks,
    signal,
  );
}

/** Single-shot non-streaming call used by compaction + review. Delegates to
 *  the OpenAI Chat Completions summarizer with the custom base URL. */
export async function summarize(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  baseUrl: string,
  maxTokens = 4096,
): Promise<{ text: string; usage: TurnUsage }> {
  return openaiSummarize(apiKey, model, system, user, maxTokens, baseUrl);
}

/** Probe the endpoint to confirm it's reachable and OpenAI-compatible. We
 *  GET `{baseUrl}/models` — the cheapest universally-implemented endpoint —
 *  rather than burning a chat completion (we don't know a valid model id
 *  yet, and a self-hosted server may have only one loaded). Returns null on
 *  success, or a human-readable error string. Used by the "Test connection"
 *  button in the settings modal. */
export async function validateConnection(baseUrl: string, apiKey: string): Promise<string | null> {
  const base = baseUrl.trim();
  if (base.length === 0) return 'Enter an endpoint URL first.';
  if (!/^https?:\/\//i.test(base)) return 'URL must start with http:// or https://';
  try {
    const res = await fetch(modelsUrl(base), { method: 'GET', headers: authHeaders(apiKey) });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) {
      return `${res.status}: endpoint requires an API key (or the key is wrong).`;
    }
    const body = await res.text().catch(() => '');
    return `${res.status}: ${body.slice(0, 200) || res.statusText || 'request failed'}`;
  } catch (err) {
    // Network error, CORS rejection, or mixed-content block (https page →
    // http endpoint). The message is the most useful thing we can surface.
    return err instanceof Error ? err.message : String(err);
  }
}

/** List the models the endpoint advertises. Unlike the OpenAI helper we do
 *  NOT filter to gpt-/o- families — a self-hosted server serves whatever the
 *  user loaded, under arbitrary ids. Throws on a non-OK response so the
 *  caller can surface why the fetch failed. */
export async function listModels(baseUrl: string, apiKey: string): Promise<{ id: string; label: string }[]> {
  const base = baseUrl.trim();
  if (base.length === 0) throw new Error('Enter an endpoint URL first.');
  const res = await fetch(modelsUrl(base), { method: 'GET', headers: authHeaders(apiKey) });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Endpoint requires an API key (or the key is wrong).');
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
  const out: { id: string; label: string }[] = [];
  for (const m of data.data ?? []) {
    if (m.id) out.push({ id: m.id, label: m.id });
  }
  out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return out;
}
