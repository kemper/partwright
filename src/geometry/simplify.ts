// Mesh decimation: reduce a Manifold's triangle count to a target budget by
// binary-searching the geometric tolerance fed to Manifold.simplify(). The UI
// exposes this as a "max triangles" slider; this module turns that target into
// the gentlest tolerance that meets it.

import type { MeshData } from './types';

/** The slice of the manifold-3d Manifold surface this search relies on. Kept
 *  structural so we don't lean on the WASM module's loose `any` typing. The
 *  caller owns the manifold passed in (it is never deleted here); every
 *  intermediate manifold this module allocates is released before returning. */
export interface SimplifiableManifold {
  numTri(): number;
  simplify(tolerance?: number): SimplifiableManifold;
  getMesh(): {
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    numVert: number;
    numTri: number;
    numProp: number;
    mergeFromVert?: Uint32Array;
    mergeToVert?: Uint32Array;
    runIndex?: Uint32Array;
    runOriginalID?: Uint32Array;
  };
  delete?(): void;
}

export interface SimplifyResult {
  mesh: MeshData;
  /** Triangle count actually achieved (≤ target when the geometry allows). */
  triangleCount: number;
  /** Tolerance passed to Manifold.simplify() to reach this result. */
  tolerance: number;
}

const SEARCH_ITERATIONS = 16;
// A closed manifold needs at least four triangles; anything below that is a
// collapsed/degenerate result we never want to hand back.
const MIN_VALID_TRIANGLES = 4;

function toMeshData(m: SimplifiableManifold): MeshData {
  // getMesh() may hand back views into the WASM heap; slice() copies them onto
  // the JS heap so they stay valid after the manifold is deleted.
  const mesh = m.getMesh();
  return {
    vertProperties: mesh.vertProperties.slice(),
    triVerts: mesh.triVerts.slice(),
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp: mesh.numProp,
    ...(mesh.mergeFromVert ? { mergeFromVert: mesh.mergeFromVert.slice() } : {}),
    ...(mesh.mergeToVert ? { mergeToVert: mesh.mergeToVert.slice() } : {}),
    ...(mesh.runIndex ? { runIndex: mesh.runIndex.slice() } : {}),
    ...(mesh.runOriginalID ? { runOriginalID: mesh.runOriginalID.slice() } : {}),
  };
}

function release(m: SimplifiableManifold | null): void {
  if (m && typeof m.delete === 'function') {
    try { m.delete(); } catch { /* already freed */ }
  }
}

/** Find the gentlest simplification of `manifold` whose triangle count is at
 *  most `targetTriangles`, by binary-searching the tolerance passed to
 *  Manifold.simplify() (larger tolerance ⇒ fewer triangles).
 *
 *  `maxTolerance` bounds the search — pass roughly half the bounding-box
 *  diagonal; beyond that the mesh collapses and there is nothing more to gain.
 *
 *  Returns null when no reduction is needed (target ≥ current triangle count)
 *  or possible, signalling the caller to keep the original mesh. The input
 *  manifold is borrowed, never deleted; every intermediate manifold allocated
 *  during the search is released here. */
export function simplifyToTriangleBudget(
  manifold: SimplifiableManifold,
  targetTriangles: number,
  maxTolerance: number,
): SimplifyResult | null {
  const baseTri = manifold.numTri();
  const target = Math.max(MIN_VALID_TRIANGLES, Math.floor(targetTriangles));
  if (!Number.isFinite(target) || target >= baseTri) return null;
  if (!(maxTolerance > 0)) return null;

  let lo = 0;
  let hi = maxTolerance;

  // Smallest tolerance that lands within [MIN_VALID_TRIANGLES, target].
  let bestTol = -1;
  // Tolerance giving the fewest valid (≥ MIN_VALID_TRIANGLES) triangles seen —
  // the fallback when the target sits below what the geometry can reach.
  let fewestValidTol = -1;
  let fewestValidCount = Infinity;

  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    let n: number;
    try {
      const candidate = manifold.simplify(mid);
      n = candidate.numTri();
      release(candidate);
    } catch {
      // A tolerance aggressive enough to collapse the mesh can throw — treat it
      // as too aggressive and pull the search back toward more detail.
      hi = mid;
      continue;
    }

    if (n >= MIN_VALID_TRIANGLES && n < fewestValidCount) {
      fewestValidCount = n;
      fewestValidTol = mid;
    }

    if (n < MIN_VALID_TRIANGLES) {
      hi = mid; // too aggressive — back off toward more triangles
    } else if (n <= target) {
      bestTol = mid; // within budget — try to keep more detail
      hi = mid;
    } else {
      lo = mid; // not reduced enough yet
    }
  }

  const tolerance = bestTol >= 0 ? bestTol : fewestValidTol;
  if (tolerance < 0) return null;

  const final = manifold.simplify(tolerance);
  const result: SimplifyResult = {
    mesh: toMeshData(final),
    triangleCount: final.numTri(),
    tolerance,
  };
  release(final);
  return result;
}
