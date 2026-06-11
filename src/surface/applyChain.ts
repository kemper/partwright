// Applies an `api.surface.*` op chain to a mesh — the pure compute kernel
// shared by the surface Worker (`surfaceWorker.ts`, the normal path) and the
// in-process fallback (`surfaceOps.ts` when `Worker` is unavailable: vitest's
// node environment). Worker-clean by construction: everything it reaches
// (modifier math, UV unwrap, subdivision, the WebGPU knit path) is pure
// math with no DOM dependency — `navigator.gpu` exists in Chromium Workers
// and the GPU knit path falls back to JS elsewhere.

import type { MeshData } from '../geometry/types';
import type { SurfaceOp, SurfaceOpId } from './surfaceOpSpec';
import {
  applyFuzzy, applyKnitAsync, applyCable, applyWaffle, applyFur, applyWoven, applyKnurl, applyVoronoi, applySmooth,
  defaultFuzzyOptions, defaultKnitOptions, defaultCableOptions, defaultWaffleOptions,
  defaultFurOptions, defaultWovenOptions, defaultKnurlOptions, defaultVoronoiOptions, defaultSmoothOptions,
} from './modifiers';

/** Apply one op to `mesh`, filling size-relative defaults from the actual mesh
 *  and reusing the modifier math. The async knit path uses the GPU when present. */
export async function applySurfaceOp(mesh: MeshData, op: SurfaceOp): Promise<MeshData> {
  const p = op.params;
  switch (op.id) {
    case 'fuzzy':   return applyFuzzy(mesh, { ...defaultFuzzyOptions(mesh), ...p }).mesh;
    case 'knit':    return (await applyKnitAsync(mesh, { ...defaultKnitOptions(mesh), ...p })).mesh;
    case 'cable':   return applyCable(mesh, { ...defaultCableOptions(mesh), ...p }).mesh;
    case 'waffle':  return applyWaffle(mesh, { ...defaultWaffleOptions(mesh), ...p }).mesh;
    case 'fur':     return applyFur(mesh, { ...defaultFurOptions(mesh), ...p }).mesh;
    case 'woven':   return applyWoven(mesh, { ...defaultWovenOptions(mesh), ...p }).mesh;
    case 'knurl':   return applyKnurl(mesh, { ...defaultKnurlOptions(mesh), ...p }).mesh;
    case 'voronoi': return applyVoronoi(mesh, { ...defaultVoronoiOptions(mesh), ...p }).mesh;
    case 'smooth':  return applySmooth(mesh, { ...defaultSmoothOptions(), ...p }).mesh;
    default: {
      // Exhaustiveness guard — a new SurfaceOpId must add a case above.
      const _never: never = op.id;
      throw new Error(`surface: unsupported op "${_never as SurfaceOpId}"`);
    }
  }
}

/** Apply `ops` to `base` in order, reporting each completed prefix through
 *  `onOpApplied` (so the caller can memoize every intermediate). Returns the
 *  final mesh. */
export async function applyChainOps(
  base: MeshData,
  ops: SurfaceOp[],
  onOpApplied?: (index: number, mesh: MeshData) => void | Promise<void>,
): Promise<MeshData> {
  let mesh = base;
  for (let i = 0; i < ops.length; i++) {
    mesh = await applySurfaceOp(mesh, ops[i]);
    await onOpApplied?.(i, mesh);
  }
  return mesh;
}
