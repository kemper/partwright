// Unit tests for the direct (single-pass) simplify/enhance helpers added for
// the "by edge length / size" knobs. These don't search for a triangle budget —
// they run one Manifold.simplify(tolerance) or refineToLength(length) pass — so
// a tiny fake SimplifiableManifold is enough to exercise the contract:
//   - non-positive args → null
//   - a pass that doesn't change the triangle count → null (UI warns)
//   - a collapse below MIN_VALID_TRIANGLES → null
//   - a genuine change → a SimplifyResult carrying the new mesh + count

import { describe, it, expect } from 'vitest';
import { simplifyToTolerance, refineToEdgeLength, type SimplifiableManifold } from '../../src/geometry/simplify';

/** A fake manifold whose simplify/refineToLength produce a caller-chosen
 *  triangle count, with a tiny valid mesh so toMeshData() succeeds. Tracks
 *  whether the intermediate it returns was deleted (so we can assert the
 *  helpers release what they allocate and never delete the borrowed input). */
function fakeManifold(opts: {
  baseTri: number;
  simplifyTo?: (tol: number) => number | 'throw';
  refineTo?: (len: number) => number | 'throw';
}): { m: SimplifiableManifold; deletes: number; selfDeleted: boolean } {
  const state = { deletes: 0, selfDeleted: false };

  const makeMesh = () => ({
    vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    triVerts: new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]),
    numVert: 4,
    numTri: 4,
    numProp: 3,
  });

  const child = (tri: number): SimplifiableManifold => ({
    numTri: () => tri,
    simplify: () => child(tri),
    refineToLength: () => child(tri),
    getMesh: makeMesh,
    delete: () => { state.deletes++; },
  });

  const m: SimplifiableManifold = {
    numTri: () => opts.baseTri,
    simplify: (tol = 0) => {
      const r = opts.simplifyTo?.(tol);
      if (r === 'throw') throw new Error('collapsed');
      return child(r ?? opts.baseTri);
    },
    refineToLength: (len) => {
      const r = opts.refineTo?.(len);
      if (r === 'throw') throw new Error('exploded');
      return child(r ?? opts.baseTri);
    },
    getMesh: makeMesh,
    delete: () => { state.selfDeleted = true; },
  };

  return { m, get deletes() { return state.deletes; }, get selfDeleted() { return state.selfDeleted; } };
}

describe('simplifyToTolerance', () => {
  it('returns null for a non-positive tolerance', () => {
    const { m } = fakeManifold({ baseTri: 100 });
    expect(simplifyToTolerance(m, 0)).toBeNull();
    expect(simplifyToTolerance(m, -1)).toBeNull();
  });

  it('returns null when the pass does not reduce the triangle count', () => {
    const f = fakeManifold({ baseTri: 100, simplifyTo: () => 100 });
    expect(simplifyToTolerance(f.m, 0.5)).toBeNull();
    expect(f.deletes).toBe(1);      // intermediate released
    expect(f.selfDeleted).toBe(false); // borrowed input never deleted
  });

  it('returns null when the mesh collapses below the minimum', () => {
    const f = fakeManifold({ baseTri: 100, simplifyTo: () => 2 });
    expect(simplifyToTolerance(f.m, 0.5)).toBeNull();
  });

  it('returns null (not a throw) when simplify throws on an aggressive tolerance', () => {
    const f = fakeManifold({ baseTri: 100, simplifyTo: () => 'throw' });
    expect(simplifyToTolerance(f.m, 99)).toBeNull();
  });

  it('returns the reduced mesh + count on a genuine reduction', () => {
    const f = fakeManifold({ baseTri: 100, simplifyTo: () => 40 });
    const r = simplifyToTolerance(f.m, 0.5);
    expect(r).not.toBeNull();
    expect(r!.triangleCount).toBe(40);
    expect(r!.tolerance).toBe(0.5);
    expect(r!.mesh.numTri).toBe(4);
    expect(f.selfDeleted).toBe(false);
  });
});

describe('refineToEdgeLength', () => {
  it('returns null for a non-positive length', () => {
    const { m } = fakeManifold({ baseTri: 100 });
    expect(refineToEdgeLength(m, 0)).toBeNull();
  });

  it('returns null when refineToLength is unavailable', () => {
    const { m } = fakeManifold({ baseTri: 100 });
    const noRefine: SimplifiableManifold = { ...m, refineToLength: undefined };
    expect(refineToEdgeLength(noRefine, 1)).toBeNull();
  });

  it('returns null when no edge was long enough (count unchanged)', () => {
    const f = fakeManifold({ baseTri: 100, refineTo: () => 100 });
    expect(refineToEdgeLength(f.m, 5)).toBeNull();
    expect(f.deletes).toBe(1);
  });

  it('returns the densified mesh + count when edges were split', () => {
    const f = fakeManifold({ baseTri: 100, refineTo: () => 400 });
    const r = refineToEdgeLength(f.m, 0.5);
    expect(r).not.toBeNull();
    expect(r!.triangleCount).toBe(400);
    expect(r!.tolerance).toBe(0.5);
    expect(f.selfDeleted).toBe(false);
  });
});
