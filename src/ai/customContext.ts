// Context sizing for the Custom (OpenAI-compatible) provider.
//
// Hosted providers get the full payload: PREAMBLE + the in-app ai.md (~27k
// tokens) and the core tool schemas (~17k; more groups load on demand, or
// every tool at ~66k with on-demand groups off) — about 45k tokens before the
// user types a word. That is fine for a frontier model with prompt caching,
// but a local model behind llama.cpp / vLLM / LM Studio / Ollama on consumer
// hardware usually runs a 8k–64k window: the request is rejected (or, on
// Ollama, silently truncated past `num_ctx`), and even when it fits the
// prefill takes minutes per agent step.
//
// So a Custom endpoint carries a context profile: the window it really has
// (typed by the user, or detected on Connect from whatever metadata the
// server exposes) and a prompt tier. Medium / Slim reuse the hand-tuned local
// prompts (which pull topic docs on demand through readDoc) and send a
// reduced, compacted tool set. Auto picks the tier from the window and stays
// Full when the window is unknown — a CLIProxyAPI bridge in front of a
// frontier model should keep getting everything.

import { getConfig } from '../config/appConfig';
import type { ChatToggles, CustomContextSettings, CustomPromptTier } from './types';

export type ResolvedCustomTier = Exclude<CustomPromptTier, 'auto'>;

/** The parts of a tools.ts ToolDefinition this module reads — structural, so
 *  settings.ts can import this module without a tools.ts cycle. */
interface ToolShape {
  name: string;
  description: string;
  input_schema: object;
}

export const DEFAULT_CUSTOM_CONTEXT: CustomContextSettings = { window: 0, modelWindows: {}, promptTier: 'auto' };

const TIERS: readonly CustomPromptTier[] = ['auto', 'full', 'medium', 'slim'];

export function isCustomPromptTier(v: unknown): v is CustomPromptTier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

function positiveInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Validate a persisted/imported context profile, defaulting anything bad. */
export function parseCustomContext(raw: unknown): CustomContextSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const modelWindows: Record<string, number> = {};
  if (r.modelWindows && typeof r.modelWindows === 'object') {
    for (const [id, n] of Object.entries(r.modelWindows as Record<string, unknown>)) {
      const w = positiveInt(n);
      if (w > 0) modelWindows[id] = w;
    }
  }
  return {
    window: positiveInt(r.window),
    modelWindows,
    promptTier: isCustomPromptTier(r.promptTier) ? r.promptTier : 'auto',
  };
}

type ContextToggles = Pick<ChatToggles, 'customModel' | 'customContext'>;

/** The Custom endpoint's context window in tokens: the user's value, else
 *  the one detected for the selected model, else 0 (unknown). */
export function customContextWindow(t: ContextToggles): number {
  const c = t.customContext;
  if (c.window > 0) return c.window;
  return c.modelWindows[t.customModel.trim()] ?? 0;
}

/** The tier actually sent. Auto: unknown window → Full; a window under
 *  `customSlimMaxContext` → Slim; under `customMediumMaxContext` → Medium. */
export function resolveCustomPromptTier(t: ContextToggles): ResolvedCustomTier {
  const tier = t.customContext.promptTier;
  if (tier !== 'auto') return tier;
  const w = customContextWindow(t);
  if (w <= 0) return 'full';
  const cfg = getConfig().ai;
  if (w < cfg.customSlimMaxContext) return 'slim';
  if (w < cfg.customMediumMaxContext) return 'medium';
  return 'full';
}

/** Slim: write code, run it, look at it, read docs, keep the session. */
export const SLIM_CUSTOM_TOOLS: readonly string[] = [
  'getActiveLanguage', 'setActiveLanguage', 'getCode', 'setCode', 'getParams', 'setParams',
  'runCode', 'runAndSave', 'runAndAssert', 'getGeometryData', 'query',
  'readDoc', 'getSessionContext', 'listVersions', 'loadVersion', 'forkVersion', 'addSessionNote',
  'renderView', 'renderViews', 'getAttachments', 'listLabels', 'paintByLabel', 'finish',
];

/** Medium adds everyday painting, inspection, objects and textures. */
export const MEDIUM_CUSTOM_TOOLS: readonly string[] = [
  ...SLIM_CUSTOM_TOOLS,
  'getMeshSummary', 'listComponents', 'paintComponent', 'paintByLabels', 'paintRegion', 'paintNear',
  'paintInBox', 'paintSlab', 'paintConnected', 'listRegions', 'removeRegion', 'undoLastPaint',
  'clearColors', 'probePixel', 'probeRay', 'findFaces', 'saveVersion', 'modifyAndTest',
  'runAndExplain', 'photoMatch', 'checkPrintability', 'getReferenceImages', 'listSessionNotes',
  'listObjects', 'getCurrentObject', 'createObject', 'changeObject', 'diffVersions',
  'applySurfaceTexture', 'scaleModel',
];

/** First sentence of `text`, cut to `max` chars. */
export function firstSentence(text: string, max: number): string {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  let out = (m ? m[0] : text).trim();
  if (out.length > max) out = out.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
  return out;
}

/** Shorten (paramChars > 0) or drop (paramChars ≤ 0) every `description`
 *  nested in a JSON schema; everything else (types, enums, required, bounds)
 *  is kept so arguments still validate. */
function compactSchema(schema: unknown, paramChars: number): unknown {
  if (Array.isArray(schema)) return schema.map(s => compactSchema(s, paramChars));
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'description' && typeof v === 'string') {
      if (paramChars > 0) out[k] = firstSentence(v, paramChars);
      continue;
    }
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = compactSchema(pv, paramChars);
      out[k] = props;
      continue;
    }
    out[k] = compactSchema(v, paramChars);
  }
  return out;
}

export function compactTool<T extends ToolShape>(t: T, descChars: number, paramChars: number): T {
  return {
    ...t,
    description: firstSentence(t.description, descChars),
    input_schema: compactSchema(t.input_schema, paramChars) as T['input_schema'],
  };
}

/** The tool list for a tier: Full is untouched; Medium / Slim keep only
 *  their subset of the already-gated `tools` (toggle gating still applies)
 *  with compacted descriptions. Slim drops parameter descriptions. */
export function toolsForCustomTier<T extends ToolShape>(tools: T[], tier: ResolvedCustomTier): T[] {
  if (tier === 'full') return tools;
  const cfg = getConfig().ai;
  const keep = new Set(tier === 'slim' ? SLIM_CUSTOM_TOOLS : MEDIUM_CUSTOM_TOOLS);
  const paramChars = tier === 'slim' ? 0 : cfg.customParamDescriptionChars;
  return tools.filter(t => keep.has(t.name)).map(t => compactTool(t, cfg.customToolDescriptionChars, paramChars));
}

/** Appended to a Medium / Slim system prompt so the model knows why it can't
 *  see every tool it might read about in a doc. */
export const REDUCED_TOOLS_NOTE = '\n\nThis endpoint has a small context window, so you have a reduced tool set with short descriptions. If a doc mentions a tool you do not have, do the same thing in code (runAndSave) instead.';

// === Detection ===

/** Server root for the non-OpenAI metadata routes: the base URL without a
 *  trailing `/v1` (llama.cpp `/props`, Ollama `/api/ps`, LM Studio `/api/v0`). */
export function serverRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** `/v1/models` entries that carry a window: vLLM `max_model_len` (what
 *  the server was started with), a loaded length, or OpenRouter-style
 *  `context_length`. Advertised model maxima are skipped — llama.cpp's
 *  `meta.n_ctx_train` and LM Studio's `max_context_length` describe what
 *  the model COULD take, and a load usually uses far less. */
export function contextWindowsFromModelList(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data as Array<Record<string, unknown>>) {
    if (!m || typeof m.id !== 'string') continue;
    const w = positiveInt(m.max_model_len) || positiveInt(m.loaded_context_length)
      || positiveInt(m.context_length) || positiveInt(m.context_window);
    if (w > 0) out[m.id] = w;
  }
  return out;
}

/** llama.cpp `/props`: the slot context the server is running with. */
export function contextFromLlamaCppProps(json: unknown): number {
  const j = json as { default_generation_settings?: { n_ctx?: unknown }; n_ctx?: unknown } | null;
  return positiveInt(j?.default_generation_settings?.n_ctx) || positiveInt(j?.n_ctx);
}

/** Ollama `/api/ps`: loaded models and the context each was loaded with. */
export function contextWindowsFromOllamaPs(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const models = (json as { models?: unknown })?.models;
  if (!Array.isArray(models)) return out;
  for (const m of models as Array<Record<string, unknown>>) {
    const w = positiveInt(m?.context_length);
    if (w <= 0) continue;
    for (const key of [m.name, m.model]) if (typeof key === 'string') out[key] = w;
  }
  return out;
}

/** LM Studio `/api/v0/models`: the length a LOADED model runs with. An
 *  unloaded model only reports its maximum, and LM Studio's on-demand load
 *  uses its own (much smaller) default — so that stays unknown. */
export function contextWindowsFromLmStudio(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data as Array<Record<string, unknown>>) {
    if (!m || typeof m.id !== 'string') continue;
    const w = positiveInt(m.loaded_context_length);
    if (w > 0) out[m.id] = w;
  }
  return out;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(getConfig().ai.customContextProbeTimeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Best-effort: ask the server what context each model runs with. Every
 *  probe may 404, time out or be blocked by CORS — that just means no value.
 *  Runtime values (what a model is loaded with) win over advertised maxima. */
export async function detectContextWindows(baseUrl: string, apiKey: string, modelIds: string[]): Promise<Record<string, number>> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return {};
  const root = serverRoot(base);
  const [list, props, ollama, lmstudio] = await Promise.all([
    getJson(`${base}/models`, apiKey),
    getJson(`${root}/props`, apiKey),
    getJson(`${root}/api/ps`, apiKey),
    getJson(`${root}/api/v0/models`, apiKey),
  ]);
  const out: Record<string, number> = { ...contextWindowsFromModelList(list) };
  // llama.cpp serves one model per server: its n_ctx applies to every id.
  const nCtx = contextFromLlamaCppProps(props);
  if (nCtx > 0) for (const id of modelIds) out[id] = nCtx;
  Object.assign(out, contextWindowsFromLmStudio(lmstudio), contextWindowsFromOllamaPs(ollama));
  return out;
}
