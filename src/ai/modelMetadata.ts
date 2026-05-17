// Per-model ceiling lookup for WebLLM local models.
//
// Each MLC-compiled model ships a `mlc-chat-config.json` in its HF repo
// declaring the WASM's actual compile-time context window — which is
// often much larger than the conservative 4K default that WebLLM's
// prebuilt config carries. Fetching that file lets us request the real
// ceiling at engine.reload() time instead of guessing high and tripping
// the auto-fallback.
//
// Cached forever in localStorage keyed by model_id (immutable per
// model_id) so we only pay the ~1 KB network fetch on first use.

const CACHE_KEY = 'partwright-model-ceilings-v1';

interface CeilingCache {
  [modelId: string]: {
    contextWindowSize: number;
    prefillChunkSize?: number;
    fetchedAt: number;
    /** Source URL the config was fetched from — kept for debugging when a
     *  later fetch returns a different ceiling and we need to invalidate. */
    source: string;
  };
}

let memCache: CeilingCache | null = null;
const inFlight = new Map<string, Promise<number | null>>();

function loadDiskCache(): CeilingCache {
  if (memCache !== null) return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    memCache = raw ? (JSON.parse(raw) as CeilingCache) : {};
  } catch {
    memCache = {};
  }
  return memCache;
}

function writeDiskCache(): void {
  if (memCache === null) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(memCache));
  } catch {
    // localStorage may be full or disabled — non-fatal, we keep the
    // in-memory copy for this session.
  }
}

/** Synchronous read of any cached ceiling for the given model id. Returns
 *  null when the config hasn't been fetched yet (the UI can fall back to
 *  the per-model default declared in `localModels.ts`). */
export function getCachedCeiling(modelId: string): number | null {
  const cache = loadDiskCache();
  const entry = cache[modelId];
  return entry ? entry.contextWindowSize : null;
}

/** Fetch + cache the actual context window the model's compiled WASM
 *  supports. Returns null when the fetch fails (offline, repo restructured,
 *  HF rate limit) — callers should fall back to the curated default.
 *  Single-flighted: concurrent calls for the same model wait on one
 *  network round trip. */
export async function getModelCeiling(modelId: string, modelUrl: string): Promise<number | null> {
  const cached = getCachedCeiling(modelId);
  if (cached !== null) return cached;
  const existing = inFlight.get(modelId);
  if (existing) return existing;

  const promise = fetchCeiling(modelId, modelUrl);
  inFlight.set(modelId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(modelId);
  }
}

async function fetchCeiling(modelId: string, modelUrl: string): Promise<number | null> {
  // HF serves files under `raw/main/<path>` for the default branch.
  // `resolve/main/` works too but redirects through a CDN — `raw/` is
  // smaller for a config file.
  const configUrl = `${modelUrl.replace(/\/$/, '')}/raw/main/mlc-chat-config.json`;
  try {
    const res = await fetch(configUrl, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json() as { context_window_size?: number; prefill_chunk_size?: number };
    const ctx = data.context_window_size;
    if (typeof ctx !== 'number' || !Number.isFinite(ctx) || ctx <= 0) return null;
    const cache = loadDiskCache();
    cache[modelId] = {
      contextWindowSize: Math.floor(ctx),
      prefillChunkSize: typeof data.prefill_chunk_size === 'number' ? data.prefill_chunk_size : undefined,
      fetchedAt: Date.now(),
      source: configUrl,
    };
    writeDiskCache();
    return cache[modelId].contextWindowSize;
  } catch {
    // Network error / CORS / bad JSON — silently fall back.
    return null;
  }
}

/** Build a fallback ladder of window sizes to try in sequence when the
 *  initial reload fails. Starts from `desired`, halves down to 2048,
 *  finishes at 4096 as the absolute floor. De-duplicated, sorted
 *  descending. The goal is to land on the highest size the WASM actually
 *  accepts rather than nuking down to 4K on any failure. */
export function buildFallbackLadder(desired: number): number[] {
  const candidates = new Set<number>();
  candidates.add(desired);
  let cur = desired;
  while (cur > 4096) {
    cur = Math.max(4096, Math.floor(cur / 2));
    candidates.add(cur);
  }
  candidates.add(4096);
  return Array.from(candidates).filter(v => v > 0).sort((a, b) => b - a);
}
