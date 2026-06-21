// Main-thread coordination + memoization of `api.surface.*` ops.
//
// The geometry Worker records an ordered chain of surface ops
// (`MeshResult.surfaceOps`) during a run but never touches the mesh. Here we
// apply that chain to the run's base mesh — normally inside the dedicated
// surface Worker (`surfaceWorker.ts`) so the UI stays responsive, with an
// in-process fallback where `Worker` doesn't exist (vitest's node env). Each
// prefix of the chain is memoized by `hash(baseKey + serialized op-chain)` so:
//   - a cache hit is instant (no recompute), and
//   - editing op[i] reuses op[0..i-1]'s cached result.
//
// The base identity is the BASE MESH CONTENT (`meshContentKey`), not the
// source text — so whitespace/comment/refactor edits that produce the same
// geometry keep every cached texture, and any edit that changes the geometry
// re-keys the chain no matter how it was expressed.
//
// main.ts applies chains on every run with an inline "Applying textures…"
// timer + Cancel; `cancelSurfaceCompute` (terminate+respawn — the only true
// interrupt for synchronous per-op math) rejects the in-flight computeChain
// with `SurfaceComputeCancelled`, and the caller falls back to the base mesh
// + the sticky "Re-apply" pill.

import type { MeshData } from '../geometry/types';
import { simpleHash } from '../geometry/statsComputation';
import type { SurfaceOp, ResolvedScope } from './surfaceOpSpec';
import type { ChainOp } from './applyChain';

/** Memo cache: prefix key → textured mesh after that prefix of the chain.
 *  Bounded so a long editing session can't grow it without limit (insertion
 *  order = eviction order; the hot full-chain key is re-set on every hit so it
 *  stays warm). */
const cache = new Map<string, MeshData>();
const MAX_CACHE_ENTRIES = 32;

function remember(key: string, mesh: MeshData): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, mesh);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Content hash of the geometry a texture chain sits on: FNV-1a over the
 *  vertex and index buffers (+ the layout scalars). Two runs whose base mesh
 *  is byte-identical share every cached texture — regardless of how the
 *  source text changed (whitespace, comments, refactors) — and any real
 *  geometry change re-keys the chain. ~milliseconds even on multi-MB meshes. */
export function meshContentKey(mesh: MeshData): string {
  let h = 0x811c9dc5;
  const mix = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(new Uint8Array(mesh.vertProperties.buffer, mesh.vertProperties.byteOffset, mesh.vertProperties.byteLength));
  mix(new Uint8Array(mesh.triVerts.buffer, mesh.triVerts.byteOffset, mesh.triVerts.byteLength));
  // The modifier kernel carries the base mesh's triColors into its output, so
  // a colored base must key differently from an uncolored (or differently
  // colored) one — otherwise a cache hit could serve a mis-colored texture.
  if (mesh.triColors) mix(new Uint8Array(mesh.triColors.buffer, mesh.triColors.byteOffset, mesh.triColors.byteLength));
  return `m${(h >>> 0).toString(36)}-${mesh.numVert}-${mesh.numTri}-${mesh.numProp}${mesh.triColors ? 'c' : ''}`;
}

/** Stable key for the chain prefix `ops[0..upTo]` against a given base identity.
 *  `baseKey` is the base mesh's content hash (see {@link meshContentKey}), so
 *  the same geometry + ops always maps to the same key — and any
 *  geometry-affecting change shifts it (→ a recompute). */
function prefixKey(baseKey: string, ops: SurfaceOp[], upTo: number): string {
  // Include `scope` (declarative): a scoped op produces a different mesh than
  // the same op unscoped, so they must key apart. The resolved seeds are NOT
  // keyed — they derive deterministically from scope + the base mesh (baseKey).
  const chain = ops.slice(0, upTo + 1).map(o => ({ id: o.id, params: o.params, scope: o.scope }));
  return simpleHash(`${baseKey}|${JSON.stringify(chain)}`);
}

/** Cache lookup for a fully-applied chain. `cached: true` with `mesh` means the
 *  textured result is ready to render; `cached: false` means at least the final
 *  op must be recomputed. An empty chain is trivially "cached" with no mesh
 *  (caller keeps the base mesh). */
export function surfaceCacheStatus(baseKey: string, ops: SurfaceOp[]): { cached: boolean; mesh: MeshData | null } {
  if (ops.length === 0) return { cached: true, mesh: null };
  const mesh = cache.get(prefixKey(baseKey, ops, ops.length - 1));
  if (mesh) {
    // Touch so the hot full-chain key resists eviction.
    remember(prefixKey(baseKey, ops, ops.length - 1), mesh);
    return { cached: true, mesh };
  }
  return { cached: false, mesh: null };
}

/** The memo key for a fully-applied chain, or null for an empty chain. This is
 *  the key persisted with a saved version (`Version.surfaceTexture`) so the
 *  computed mesh can be re-seeded on load — see {@link seedSurfaceCache}. */
export function surfaceChainKey(baseKey: string, ops: SurfaceOp[]): string | null {
  if (ops.length === 0) return null;
  return prefixKey(baseKey, ops, ops.length - 1);
}

/** Warm the memo cache with a previously computed result (a texture persisted
 *  on a saved version). The next `surfaceCacheStatus` / `computeChain` for the
 *  same base identity + chain hits instead of recomputing. A key that no longer
 *  matches anything simply ages out of the LRU — seeding is always safe. */
export function seedSurfaceCache(key: string, mesh: MeshData): void {
  remember(key, mesh);
}

/** Thrown (as the computeChain rejection) when the in-flight compute was
 *  cancelled — by the user's Cancel button or by a newer compute superseding
 *  it. The caller shows the base mesh + the Re-apply pill, not an error. */
export class SurfaceComputeCancelled extends Error {
  constructor() { super('Surface texture compute cancelled'); }
}

// === Worker client ===

interface PendingCall {
  callId: number;
  baseKey: string;
  ops: SurfaceOp[];
  startIndex: number;
  resolve: (mesh: MeshData) => void;
  reject: (err: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
let pending: PendingCall | null = null;
let nextCallId = 1;

function initWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./surfaceWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ type: string; callId: number; index?: number; mesh?: MeshData; message?: string }>) => {
    const msg = e.data;
    if (!pending || msg.callId !== pending.callId) return; // stale (superseded call)
    const call = pending;
    if (msg.type === 'prefix' || msg.type === 'done') {
      const absoluteIndex = call.startIndex + (msg.index ?? 0);
      remember(prefixKey(call.baseKey, call.ops, absoluteIndex), msg.mesh!);
      const remaining = call.ops.length - call.startIndex;
      call.onProgress?.(remaining > 0 ? (absoluteIndex - call.startIndex + 1) / remaining : 1);
      if (msg.type === 'done') {
        pending = null;
        call.resolve(msg.mesh!);
      }
    } else if (msg.type === 'error') {
      pending = null;
      call.reject(new Error(msg.message ?? 'surface compute failed'));
    }
  };
  worker.onerror = (e) => {
    // The Worker has faulted — tear it down so the next compute respawns a
    // fresh instance. Reusing a crashed Worker would leave the next
    // postMessage with no responder and hang the "Applying texture…" UI.
    worker?.terminate();
    worker = null;
    if (pending) {
      const call = pending;
      pending = null;
      call.reject(new Error(e.message || 'surface worker error'));
    }
  };
  return worker;
}

/** Cancel the in-flight chain compute (if any): terminate the Worker — the
 *  only true interrupt for synchronous math — and reject the pending
 *  computeChain with {@link SurfaceComputeCancelled}. The Worker respawns
 *  lazily on the next compute (the WebGPU pipeline cache rebuilds then).
 *  Returns true when something was actually cancelled. */
export function cancelSurfaceCompute(): boolean {
  if (!pending) return false;
  const call = pending;
  pending = null;
  worker?.terminate();
  worker = null;
  call.reject(new SurfaceComputeCancelled());
  return true;
}

/** True while a chain compute is running in the surface Worker. */
export function surfaceComputeInFlight(): boolean {
  return pending !== null;
}

/** Force-apply the whole chain, reusing the deepest already-cached prefix and
 *  caching every newly-computed prefix. `onProgress(fraction)` reports progress
 *  across the uncached tail. Runs in the surface Worker (so the UI thread stays
 *  free); falls back to in-process compute where `Worker` doesn't exist
 *  (vitest's node env). A computeChain that starts while another is in flight
 *  supersedes it — the older call rejects with {@link SurfaceComputeCancelled}
 *  (latest-wins, matching the editor's run generations). Returns the final
 *  textured mesh. */
export async function computeChain(
  base: MeshData,
  baseKey: string,
  ops: SurfaceOp[],
  onProgress?: (fraction: number) => void,
  resolved?: (ResolvedScope | null)[],
): Promise<MeshData> {
  if (ops.length === 0) return base;

  // The kernel sees each op with its resolved scope attached (when scoped). The
  // memo key still uses the declarative `ops` (resolved seeds derive from scope
  // + baseKey), so keying and cache lookups below stay on `ops`.
  const chainOps: ChainOp[] = resolved
    ? ops.map((op, i) => (resolved[i] ? { ...op, resolvedScope: resolved[i]! } : op))
    : ops;

  // Resume from the deepest cached prefix so editing the last op doesn't redo
  // the whole stack.
  let mesh = base;
  let start = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    const cached = cache.get(prefixKey(baseKey, ops, i));
    if (cached) { mesh = cached; start = i + 1; break; }
  }
  if (start >= ops.length) return mesh; // full chain already cached

  // In-process fallback (no Worker global — unit tier).
  if (typeof Worker === 'undefined') {
    const { applyChainOps } = await import('./applyChain');
    const remaining = ops.length - start;
    return applyChainOps(mesh, chainOps.slice(start), (i, m) => {
      remember(prefixKey(baseKey, ops, start + i), m);
      onProgress?.((i + 1) / remaining);
    });
  }

  // Latest-wins: a new compute supersedes any in-flight one.
  cancelSurfaceCompute();
  const w = initWorker();
  return new Promise<MeshData>((resolve, reject) => {
    pending = { callId: nextCallId++, baseKey, ops, startIndex: start, resolve, reject, onProgress };
    // The starting mesh may be a cache entry — post WITHOUT a transfer list so
    // the structured clone leaves the cached buffers intact.
    w.postMessage({ type: 'computeChain', callId: pending.callId, base: mesh, ops: chainOps.slice(start) });
  });
}

/** Test/diagnostic hook — clears the memo cache. */
export function __clearSurfaceCache(): void {
  cache.clear();
}

// Re-export the spec types so callers can import everything surface-op from here.
export type { SurfaceOp, SurfaceOpId } from './surfaceOpSpec';
