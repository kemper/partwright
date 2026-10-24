// Saved Custom-provider endpoints — the pure half (types, URL matching,
// seeding, backup format). Storage lives in customEndpoints.ts.
//
// A saved endpoint remembers everything needed to reconnect without
// re-entering anything: name, kind, base URL, API key, default model, the
// model list it last advertised, the reasoning opt-in, and (for a
// CLIProxyAPI bridge) the config path its setup commands use. The active
// one is copied onto ChatToggles (base URL / model / reasoning — what the
// agent Worker reads) and its key into the `aiKeys` 'custom' row; the saved
// list is the durable library those copies are made from.

import { CLI_PROXY_DEFAULT_BASE_URL, generateApiKey, looksLikeCliProxyUrl } from './cliProxy';

export type EndpointKind = 'cliproxyapi' | 'openai-compatible';

export interface SavedEndpoint {
  id: string;
  name: string;
  kind: EndpointKind;
  /** Includes the version path, e.g. http://localhost:8317/v1. */
  baseUrl: string;
  /** '' = no Authorization header. */
  apiKey: string;
  /** Default model id, applied when the endpoint is selected. */
  model: string;
  /** Ids from the last successful Connect — feeds the model pills and the
   *  AI panel's dropdown. */
  models: string[];
  /** Send the Thinking level as `reasoning_effort` (see custom.ts). */
  reasoningEffort: boolean;
  /** CLIProxyAPI only: config file path for the setup commands ('' = the
   *  OS default). */
  configPath: string;
  createdAt: number;
  updatedAt: number;
  /** Last time Connect reached the endpoint (0 = never). Collapses the
   *  bridge's install steps once it has worked. */
  lastConnectedAt: number;
}

/** Normalize a base URL for matching: trimmed, no trailing slashes,
 *  lower-cased scheme/host. Paths stay case-sensitive. */
export function normalizeBaseUrl(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  const m = t.match(/^(https?:\/\/[^/]+)(.*)$/i);
  return m ? m[1].toLowerCase() + m[2] : t;
}

/** The saved endpoint the Custom provider is currently pointed at: the one
 *  whose base URL matches the active toggles. Ties (two entries for one URL)
 *  prefer the entry whose key matches, then the most recently updated. */
export function findEndpointForUrl(list: SavedEndpoint[], baseUrl: string, apiKey?: string): SavedEndpoint | null {
  const want = normalizeBaseUrl(baseUrl);
  if (!want) return null;
  const hits = list.filter(e => normalizeBaseUrl(e.baseUrl) === want);
  if (hits.length === 0) return null;
  if (apiKey !== undefined) {
    const keyed = hits.find(e => e.apiKey === apiKey);
    if (keyed) return keyed;
  }
  return [...hits].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function newEndpoint(kind: EndpointKind, id: string, now = Date.now()): SavedEndpoint {
  return kind === 'cliproxyapi'
    ? {
      id, kind, name: 'Local CLIProxyAPI', baseUrl: CLI_PROXY_DEFAULT_BASE_URL,
      // Generated once, when the endpoint is created, and kept for good: the
      // bridge config gets this exact key appended, so it must never change
      // behind the user's back.
      apiKey: generateApiKey(),
      model: '', models: [], reasoningEffort: true, configPath: '',
      createdAt: now, updatedAt: now, lastConnectedAt: 0,
    }
    : {
      id, kind, name: 'OpenAI-compatible endpoint', baseUrl: '', apiKey: '',
      model: '', models: [], reasoningEffort: false, configPath: '',
      createdAt: now, updatedAt: now, lastConnectedAt: 0,
    };
}

/** A friendly default name from a URL's host. */
export function nameFromUrl(baseUrl: string): string {
  const m = baseUrl.trim().match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return 'Custom endpoint';
  return m[2] ? `${m[1]}:${m[2]}` : m[1];
}

/** The first saved endpoint for someone upgrading from the single-endpoint
 *  settings: built from what they already have configured, so a working
 *  connection carries over untouched (same URL, key, model). A bridge URL
 *  becomes a CLIProxyAPI entry; it keeps an existing key, or gets a fresh
 *  generated one when none was saved. */
export function seedEndpoint(
  current: { baseUrl: string; apiKey: string; model: string; models: string[]; reasoningEffort: boolean },
  id: string,
  now = Date.now(),
): SavedEndpoint {
  const baseUrl = current.baseUrl.trim() || CLI_PROXY_DEFAULT_BASE_URL;
  const kind: EndpointKind = looksLikeCliProxyUrl(baseUrl) ? 'cliproxyapi' : 'openai-compatible';
  const base = newEndpoint(kind, id, now);
  return {
    ...base,
    name: kind === 'cliproxyapi' ? base.name : nameFromUrl(baseUrl),
    baseUrl,
    apiKey: current.apiKey || base.apiKey,
    model: current.model,
    models: [...current.models],
    reasoningEffort: current.reasoningEffort || (kind === 'cliproxyapi' && !current.model),
  };
}

// === Backup file ===

const BACKUP_FORMAT = 'partwright-ai-endpoints';

export function serializeBackup(list: SavedEndpoint[], now = Date.now()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), endpoints: list }, null, 2);
}

function str(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }
function num(v: unknown, fallback = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

/** Parse a backup file. Unknown fields are dropped, missing ones defaulted;
 *  entries without an id or base URL are skipped. Throws on a file that
 *  isn't a backup at all. */
export function parseBackup(text: string): SavedEndpoint[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Not a JSON file.'); }
  const obj = parsed as { format?: unknown; endpoints?: unknown } | null;
  if (!obj || obj.format !== BACKUP_FORMAT || !Array.isArray(obj.endpoints)) {
    throw new Error('Not a Partwright endpoints backup.');
  }
  const out: SavedEndpoint[] = [];
  for (const raw of obj.endpoints as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id).trim();
    const baseUrl = str(raw.baseUrl).trim();
    if (!id || !baseUrl) continue;
    const kind: EndpointKind = raw.kind === 'cliproxyapi' ? 'cliproxyapi' : 'openai-compatible';
    out.push({
      id,
      kind,
      name: str(raw.name).trim() || nameFromUrl(baseUrl),
      baseUrl,
      apiKey: str(raw.apiKey),
      model: str(raw.model),
      models: Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [],
      reasoningEffort: raw.reasoningEffort === true,
      configPath: str(raw.configPath),
      createdAt: num(raw.createdAt),
      updatedAt: num(raw.updatedAt),
      lastConnectedAt: num(raw.lastConnectedAt),
    });
  }
  return out;
}

/** Merge imported entries into the saved list: same id → the newer
 *  `updatedAt` wins; new ids are added. Returns the merged list and how many
 *  entries were added or updated. */
export function mergeBackup(existing: SavedEndpoint[], incoming: SavedEndpoint[]): { list: SavedEndpoint[]; changed: number } {
  const byId = new Map(existing.map(e => [e.id, e]));
  let changed = 0;
  for (const e of incoming) {
    const cur = byId.get(e.id);
    if (!cur || e.updatedAt > cur.updatedAt) { byId.set(e.id, e); changed++; }
  }
  return { list: [...byId.values()], changed };
}
