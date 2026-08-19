// Low-poly decimation — the geometry behind the manifold-js sandbox's
// `api.lowPoly(shape, opts)`. Reduces a live manifold-3d Manifold to a coarse,
// deliberately-faceted triangle count via its native `.simplify(tolerance)`.
//
// Kept pure, SYNCHRONOUS, and structurally typed (no WASM import) for two
// reasons: user model code runs synchronously in the sandbox, and this module
// unit-tests against a fake manifold. The editor-side, off-thread, cancellable
// decimator for "reduce the CURRENT model" already lives in `../simplify.ts`
// (`simplifyToTriangleBudget`) — this is its in-code twin: same binary-search
// idea, but synchronous and returning a Manifold instead of MeshData.
//
// Intermediate manifolds are NOT deleted here: the sandbox wraps `.simplify()`
// for allocation tracking (see `wrapMethodsForTracking` in manifoldJs.ts), so
// every candidate this search allocates is freed when the run ends. Deleting
// them here would double-free against that tracking.

/** The minimal slice of the manifold-3d Manifold surface this search needs. */
export interface DecimatableManifold {
  numTri(): number;
  simplify(tolerance?: number): DecimatableManifold;
}

export interface LowPolyResult<T extends DecimatableManifold = DecimatableManifold> {
  /** The decimated manifold (borrowed from the sandbox's allocation tracker). */
  manifold: T;
  /** Triangle count actually achieved. */
  triangleCount: number;
  /** Tolerance passed to `.simplify()` to reach this result. */
  tolerance: number;
}

const SEARCH_ITERATIONS = 16;
// A closed manifold needs at least four triangles; below that is a collapsed
// result we never hand back.
const MIN_VALID_TRIANGLES = 4;

/** Single-pass decimate to an explicit facet size (the geometric tolerance fed
 *  to `.simplify()` — edges/vertices whose removal stays within `tolerance` of
 *  the surface collapse). Returns null when the tolerance is non-positive, the
 *  mesh collapsed below MIN_VALID_TRIANGLES, or nothing fell below the
 *  tolerance (result didn't get coarser) — the caller then keeps the input. */
export function decimateToTolerance<T extends DecimatableManifold>(
  shape: T,
  tolerance: number,
): LowPolyResult<T> | null {
  if (!(tolerance > 0)) return null;
  const baseTri = shape.numTri();
  let candidate: T;
  try {
    candidate = shape.simplify(tolerance) as T;
  } catch {
    // A tolerance aggressive enough to collapse the mesh can throw — treat as
    // "nothing usable to decimate" rather than a hard error.
    return null;
  }
  const n = candidate.numTri();
  if (n < MIN_VALID_TRIANGLES || n >= baseTri) return null;
  return { manifold: candidate, triangleCount: n, tolerance };
}

/** Binary-search the gentlest decimation of `shape` whose triangle count is at
 *  most `targetTriangles`, mirroring `simplifyToTriangleBudget` but synchronous
 *  and returning the Manifold. `maxTolerance` bounds the search — pass roughly
 *  half the bounding-box diagonal, beyond which the mesh only collapses.
 *
 *  Returns null when no reduction is needed (target ≥ current triangle count)
 *  or possible; the caller then returns the input shape unchanged (a model
 *  that is already coarse still gets flat-shaded, just not re-decimated). */
export function decimateToTriangleBudget<T extends DecimatableManifold>(
  shape: T,
  targetTriangles: number,
  maxTolerance: number,
): LowPolyResult<T> | null {
  const baseTri = shape.numTri();
  const target = Math.max(MIN_VALID_TRIANGLES, Math.floor(targetTriangles));
  if (!Number.isFinite(target) || target >= baseTri) return null;
  if (!(maxTolerance > 0)) return null;

  let lo = 0;
  let hi = maxTolerance;

  // Least-aggressive candidate within budget (most triangles, still ≤ target).
  let best: T | null = null;
  let bestTol = -1;
  // Fallback when the target sits below what the geometry can reach: the
  // candidate with the fewest valid (≥ MIN_VALID_TRIANGLES) triangles seen.
  let fewest: T | null = null;
  let fewestCount = Infinity;
  let fewestTol = -1;

  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    let candidate: T | null = null;
    let n: number | null = null;
    try {
      candidate = shape.simplify(mid) as T;
      n = candidate.numTri();
    } catch {
      // Too aggressive (collapsed) — pull the search back toward more detail.
      hi = mid;
      continue;
    }

    if (n >= MIN_VALID_TRIANGLES && n < fewestCount) {
      fewest = candidate;
      fewestCount = n;
      fewestTol = mid;
    }

    if (n < MIN_VALID_TRIANGLES) {
      hi = mid; // too aggressive — back off toward more triangles
    } else if (n <= target) {
      best = candidate; // within budget — try a smaller tolerance to keep more detail
      bestTol = mid;
      hi = mid;
    } else {
      lo = mid; // not reduced enough yet
    }
  }

  const chosen = best ?? fewest;
  if (!chosen) return null;
  return {
    manifold: chosen,
    triangleCount: chosen.numTri(),
    tolerance: best ? bestTol : fewestTol,
  };
}
