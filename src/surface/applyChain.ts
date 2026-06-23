// Applies an `api.surface.*` op chain to a mesh — the pure compute kernel
// shared by the surface Worker (`surfaceWorker.ts`, the normal path) and the
// in-process fallback (`surfaceOps.ts` when `Worker` is unavailable: vitest's
// node environment). Worker-clean by construction: everything it reaches
// (modifier math, UV unwrap, subdivision, the WebGPU knit path) is pure
// math with no DOM dependency — `navigator.gpu` exists in Chromium Workers
// and the GPU knit path falls back to JS elsewhere.

import type { MeshData } from '../geometry/types';
import type { SurfaceOp, SurfaceOpId, ResolvedScope } from './surfaceOpSpec';
import { selectTrianglesNearSeeds } from './colorTransfer';
import {
  applyFuzzy, applyKnitAsync, applyCable, applyWaffle, applyFur, applyWoven, applyKnurl, applyVoronoi, applySmooth,
  applyFuzzyPatch, applyKnitPatchAsync, applyCablePatch, applyWafflePatch, applyFurPatch, applyWovenPatch, applyKnurlPatch, applyVoronoiPatch, applySmoothPatch,
  defaultFuzzyOptions, defaultKnitOptions, defaultCableOptions, defaultWaffleOptions,
  defaultFurOptions, defaultWovenOptions, defaultKnurlOptions, defaultVoronoiOptions, defaultSmoothOptions,
} from './modifiers';

/** A chain op as the Worker / in-process kernel sees it: the recorded
 *  {@link SurfaceOp} plus its main-side-resolved scope (seed points + radius),
 *  when scoped. */
export type ChainOp = SurfaceOp & { resolvedScope?: ResolvedScope };

/** Apply one op to `mesh`, filling size-relative defaults from the actual mesh
 *  and reusing the modifier math. When the op carries a resolved scope, only
 *  the selected triangles are textured (the existing patch path); an empty
 *  selection is a no-op (the scope matched nothing on this mesh). The async
 *  knit path uses the GPU when present. */
export async function applySurfaceOp(mesh: MeshData, op: ChainOp): Promise<MeshData> {
  const p = op.params;
  const scope = op.resolvedScope;
  if (scope) {
    const sel = selectTrianglesNearSeeds(mesh, scope.seeds, scope.radius);
    if (sel.size === 0) return mesh; // scope matched no triangles — leave the mesh as-is
    switch (op.id) {
      case 'fuzzy':   return applyFuzzyPatch(mesh, { ...defaultFuzzyOptions(mesh), ...p }, sel).mesh;
      case 'knit':    return (await applyKnitPatchAsync(mesh, { ...defaultKnitOptions(mesh), ...p }, sel)).mesh;
      case 'cable':   return applyCablePatch(mesh, { ...defaultCableOptions(mesh), ...p }, sel).mesh;
      case 'waffle':  return applyWafflePatch(mesh, { ...defaultWaffleOptions(mesh), ...p }, sel).mesh;
      case 'fur':     return applyFurPatch(mesh, { ...defaultFurOptions(mesh), ...p }, sel).mesh;
      case 'woven':   return applyWovenPatch(mesh, { ...defaultWovenOptions(mesh), ...p }, sel).mesh;
      case 'knurl':   return applyKnurlPatch(mesh, { ...defaultKnurlOptions(mesh), ...p }, sel).mesh;
      case 'voronoi': return applyVoronoiPatch(mesh, { ...defaultVoronoiOptions(mesh), ...p }, sel).mesh;
      case 'smooth':  return applySmoothPatch(mesh, { ...defaultSmoothOptions(), ...p }, sel).mesh;
      default: {
        const _never: never = op.id;
        throw new Error(`surface: unsupported op "${_never as SurfaceOpId}"`);
      }
    }
  }
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
  ops: ChainOp[],
  onOpApplied?: (index: number, mesh: MeshData) => void | Promise<void>,
): Promise<MeshData> {
  let mesh = base;
  for (let i = 0; i < ops.length; i++) {
    mesh = await applySurfaceOp(mesh, ops[i]);
    await onOpApplied?.(i, mesh);
  }
  return mesh;
}
