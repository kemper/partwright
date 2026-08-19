// Unit tests for the in-code low-poly decimation helpers (api.lowPoly's engine).
// A tiny fake DecimatableManifold whose .simplify(tolerance) yields a
// caller-modelled triangle count is enough to exercise the contract:
//   - decimateToTolerance: one pass; null on non-positive / no-reduction / collapse
//   - decimateToTriangleBudget: binary-search to a budget; least-aggressive
//     candidate within budget; fallback when the target is below reach; null
//     when no reduction is needed or maxTolerance is invalid.

import { describe, it, expect } from 'vitest';
import {
  decimateToTolerance,
  decimateToTriangleBudget,
  type DecimatableManifold,
} from '../../src/geometry/engines/lowPolyOp';

/** A fake manifold whose simplify(tol) triangle count follows `simplifyTo`.
 *  Unlike the sandbox (which auto-frees via tracking), these helpers never
 *  delete — so the fake needs no delete tracking, just numTri/simplify. */
function fakeManifold(baseTri: number, simplifyTo: (tol: number) => number | 'throw'): DecimatableManifold {
  const child = (tri: number): DecimatableManifold => ({
    numTri: () => tri,
    simplify: (tol = 0) => {
      const r = simplifyTo(tol);
      if (r === 'throw') throw new Error('collapsed');
      return child(r);
    },
  });
  return {
    numTri: () => baseTri,
    simplify: (tol = 0) => {
      const r = simplifyTo(tol);
      if (r === 'throw') throw new Error('collapsed');
      return child(r);
    },
  };
}

// A smooth, monotone model: more tolerance ⇒ fewer triangles, collapsing past a
// point. Mirrors how Manifold.simplify actually behaves.
const decay = (base: number) => (tol: number): number | 'throw' => {
  const n = Math.round(base / (1 + tol));
  return n < 2 ? 'throw' : n;
};

describe('decimateToTolerance', () => {
  it('returns null for a non-positive tolerance', () => {
    const m = fakeManifold(1000, decay(1000));
    expect(decimateToTolerance(m, 0)).toBeNull();
    expect(decimateToTolerance(m, -1)).toBeNull();
  });

  it('returns null when the pass does not reduce the triangle count', () => {
    const m = fakeManifold(100, () => 100);
    expect(decimateToTolerance(m, 0.5)).toBeNull();
  });

  it('returns null when the mesh collapses below the minimum', () => {
    const m = fakeManifold(100, () => 2);
    expect(decimateToTolerance(m, 0.5)).toBeNull();
  });

  it('returns null (not a throw) when simplify throws on an aggressive tolerance', () => {
    const m = fakeManifold(100, () => 'throw');
    expect(decimateToTolerance(m, 99)).toBeNull();
  });

  it('returns the coarsened manifold + count on a genuine reduction', () => {
    const m = fakeManifold(1000, decay(1000));
    const r = decimateToTolerance(m, 4); // 1000/5 = 200
    expect(r).not.toBeNull();
    expect(r!.triangleCount).toBe(200);
    expect(r!.tolerance).toBe(4);
    expect(r!.manifold.numTri()).toBe(200);
  });
});

describe('decimateToTriangleBudget', () => {
  it('returns null when the target is at or above the current count', () => {
    const m = fakeManifold(500, decay(500));
    expect(decimateToTriangleBudget(m, 500, 50)).toBeNull();
    expect(decimateToTriangleBudget(m, 800, 50)).toBeNull();
  });

  it('returns null when maxTolerance is non-positive', () => {
    const m = fakeManifold(1000, decay(1000));
    expect(decimateToTriangleBudget(m, 100, 0)).toBeNull();
    expect(decimateToTriangleBudget(m, 100, -5)).toBeNull();
  });

  it('reduces to at most the target, staying least-aggressive (close to budget)', () => {
    const m = fakeManifold(1000, decay(1000));
    const r = decimateToTriangleBudget(m, 100, 50);
    expect(r).not.toBeNull();
    expect(r!.triangleCount).toBeLessThanOrEqual(100);
    // Least-aggressive within budget ⇒ shouldn't overshoot far below the target.
    expect(r!.triangleCount).toBeGreaterThanOrEqual(50);
    expect(r!.tolerance).toBeGreaterThan(0);
  });

  it('clamps a below-reachable target to a valid (>= 4) result via the fallback', () => {
    // Model floors at 10 triangles then collapses; target 4 is unreachable, so
    // the fewest-valid fallback (10) is returned rather than null.
    const m = fakeManifold(1000, (tol) => {
      const n = Math.round(1000 / (1 + tol));
      if (n <= 10) return tol > 200 ? 'throw' : 10;
      return n;
    });
    const r = decimateToTriangleBudget(m, 4, 500);
    expect(r).not.toBeNull();
    expect(r!.triangleCount).toBeGreaterThanOrEqual(4);
    expect(r!.triangleCount).toBe(10);
  });
});
