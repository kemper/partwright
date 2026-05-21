// Tolerance-based mesh reduction for imported geometry, backed by manifold-3d's
// `simplify(tolerance)` (removes vertices where the surface moves by less than
// the tolerance). It is great for over-tessellated CAD/printed STLs; it is NOT
// a guaranteed target-count decimator, so for a requested triangle budget we
// binary-search the smallest tolerance whose result is at or below the target.

import { getModule } from '../geometry/engine';
import { bboxFromMesh } from '../geometry/statsComputation';
import type { MeshData } from '../geometry/types';

/** Bounding-box diagonal of a mesh, used to bound the tolerance search in a
 *  scale-independent way. */
export function meshDiagonal(mesh: MeshData): number {
  const bb = bboxFromMesh(mesh);
  if (!bb) return 0;
  return Math.hypot(
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  );
}

/** Build a manifold from imported mesh data, reused across many simplify probes
 *  during the reduction search. Caller owns it and must call `.delete()`.
 *  Returns null if the engine isn't ready or the mesh isn't a manifold. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildImportManifold(mesh: MeshData): any | null {
  const mod = getModule();
  if (!mod) return null;
  try {
    return mod.Manifold.ofMesh({
      numProp: mesh.numProp,
      vertProperties: mesh.vertProperties,
      triVerts: mesh.triVerts,
    });
  } catch {
    return null;
  }
}

export interface ReductionResult {
  mesh: MeshData;
  /** Actual triangle count achieved (the search lands near, not exactly on, the
   *  target — and a mesh has a geometric floor it can't reduce past). */
  triangleCount: number;
  /** The simplify tolerance used ≈ the max distance the surface moved. */
  tolerance: number;
}

/** Binary-search the smallest simplify tolerance whose result has at most
 *  `targetTris` triangles, and return that simplified mesh. `manifold` stays
 *  owned by the caller. */
export function simplifyToTargetTriangles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifold: any,
  diag: number,
  targetTris: number,
): ReductionResult {
  let lo = 0;
  let hi = Math.max(diag, 1e-6) * 0.5; // upper tolerance bound (heavy reduction)
  let bestTol = hi;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (countAtTolerance(manifold, mid) > targetTris) {
      lo = mid;
    } else {
      hi = mid;
      bestTol = mid;
    }
  }
  const simplified = manifold.simplify(bestTol);
  const mesh = meshFromManifold(simplified);
  simplified.delete?.();
  return { mesh, triangleCount: mesh.numTri, tolerance: bestTol };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countAtTolerance(manifold: any, tolerance: number): number {
  const s = manifold.simplify(tolerance);
  const n = s.numTri();
  s.delete?.();
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function meshFromManifold(manifold: any): MeshData {
  const g = manifold.getMesh();
  return {
    numProp: g.numProp,
    vertProperties: g.vertProperties,
    triVerts: g.triVerts,
    numVert: g.numVert,
    numTri: g.numTri,
  };
}
