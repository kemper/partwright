// Main-thread application + memoization of `api.surface.*` ops.
//
// The Worker records an ordered chain of surface ops (`MeshResult.surfaceOps`)
// during a run but never touches the mesh. Here, on the main thread, we apply
// that chain to the run's base mesh by reusing the existing modifier math
// (`src/surface/modifiers.ts`, which is main-thread + WebGPU). Each prefix of
// the chain is memoized by `hash(baseKey + serialized op-chain)` so:
//   - a cache hit is instant (no recompute), and
//   - editing op[i] reuses op[0..i-1]'s cached result.
//
// "Sticky" gating lives in main.ts: on a miss we render the BASE mesh and raise
// a "Re-apply" pill rather than recomputing on every keystroke. `computeChain`
// is the explicit recompute the button triggers.

import type { MeshData } from '../geometry/types';
import { simpleHash } from '../geometry/statsComputation';
import type { SurfaceOp, SurfaceOpId } from './surfaceOpSpec';
import {
  applyFuzzy, applyKnitAsync, applyCable, applyWaffle, applyFur, applyWoven, applyVoronoi, applySmooth,
  defaultFuzzyOptions, defaultKnitOptions, defaultCableOptions, defaultWaffleOptions,
  defaultFurOptions, defaultWovenOptions, defaultVoronoiOptions, defaultSmoothOptions,
} from './modifiers';

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

/** Stable key for the chain prefix `ops[0..upTo]` against a given base identity.
 *  `baseKey` already folds in the code + customizer params (computed by the
 *  caller), so the same code+params+ops always maps to the same key — and any
 *  geometry-affecting change shifts it (→ a miss → the Re-apply pill). */
function prefixKey(baseKey: string, ops: SurfaceOp[], upTo: number): string {
  const chain = ops.slice(0, upTo + 1).map(o => ({ id: o.id, params: o.params }));
  return simpleHash(`${baseKey}|${JSON.stringify(chain)}`);
}

/** Apply one op to `mesh`, filling size-relative defaults from the actual mesh
 *  and reusing the modifier math. The async knit path uses the GPU when present. */
async function applyOne(mesh: MeshData, op: SurfaceOp): Promise<MeshData> {
  const p = op.params;
  switch (op.id) {
    case 'fuzzy':   return applyFuzzy(mesh, { ...defaultFuzzyOptions(mesh), ...p }).mesh;
    case 'knit':    return (await applyKnitAsync(mesh, { ...defaultKnitOptions(mesh), ...p })).mesh;
    case 'cable':   return applyCable(mesh, { ...defaultCableOptions(mesh), ...p }).mesh;
    case 'waffle':  return applyWaffle(mesh, { ...defaultWaffleOptions(mesh), ...p }).mesh;
    case 'fur':     return applyFur(mesh, { ...defaultFurOptions(mesh), ...p }).mesh;
    case 'woven':   return applyWoven(mesh, { ...defaultWovenOptions(mesh), ...p }).mesh;
    case 'voronoi': return applyVoronoi(mesh, { ...defaultVoronoiOptions(mesh), ...p }).mesh;
    case 'smooth':  return applySmooth(mesh, { ...defaultSmoothOptions(), ...p }).mesh;
    default: {
      // Exhaustiveness guard — a new SurfaceOpId must add a case above.
      const _never: never = op.id;
      throw new Error(`surfaceOps: unsupported op "${_never as SurfaceOpId}"`);
    }
  }
}

/** Cache lookup for a fully-applied chain. `cached: true` with `mesh` means the
 *  textured result is ready to render; `cached: false` means at least the final
 *  op must be recomputed (the sticky-pill case). An empty chain is trivially
 *  "cached" with no mesh (caller keeps the base mesh). */
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

/** Force-apply the whole chain, reusing the deepest already-cached prefix and
 *  caching every newly-computed prefix. `onProgress(fraction)` reports progress
 *  across the uncached tail. Returns the final textured mesh. */
export async function computeChain(
  base: MeshData,
  baseKey: string,
  ops: SurfaceOp[],
  onProgress?: (fraction: number) => void,
): Promise<MeshData> {
  if (ops.length === 0) return base;

  // Resume from the deepest cached prefix so editing the last op doesn't redo
  // the whole stack.
  let mesh = base;
  let start = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    const cached = cache.get(prefixKey(baseKey, ops, i));
    if (cached) { mesh = cached; start = i + 1; break; }
  }

  const remaining = ops.length - start;
  for (let i = start; i < ops.length; i++) {
    mesh = await applyOne(mesh, ops[i]);
    remember(prefixKey(baseKey, ops, i), mesh);
    onProgress?.(remaining > 0 ? (i - start + 1) / remaining : 1);
  }
  return mesh;
}

/** Test/diagnostic hook — clears the memo cache. */
export function __clearSurfaceCache(): void {
  cache.clear();
}

// Re-export the spec types so callers can import everything surface-op from here.
export type { SurfaceOp, SurfaceOpId } from './surfaceOpSpec';
