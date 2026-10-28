// The mesh-based component census (the engine Worker's big-run path) must
// agree with the exact decompose() + boolean census on ordinary cases.
import { describe, it, expect, beforeAll } from 'vitest';
import { computeManifoldFacts } from '../../src/geometry/manifoldFacts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  const Module = (await import('manifold-3d')).default;
  const mod = await Module();
  mod.setup();
  M = mod.Manifold;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function both(m: any) {
  const exact = computeManifoldFacts(m);
  const fromMesh = computeManifoldFacts(m, m.getMesh());
  return { exact, fromMesh };
}

describe('computeManifoldFacts: mesh census vs decompose census', () => {
  it('agree on disjoint, enclosed, overlapping and nested pieces', () => {
    const cases = {
      disjoint: M.compose([M.cube([10, 10, 10]), M.cube([10, 10, 10]).translate([20, 0, 0])]),
      enclosed: M.compose([M.cube([20, 20, 20], true), M.sphere(3, 32)]),
      overlapping: M.compose([M.cube([20, 20, 20], true), M.sphere(3, 32).translate([10, 0, 0])]),
      sideBySideInBox: M.compose([M.cube([30, 30, 30], true), M.cube([2, 2, 2]).translate([-8, -8, -8]), M.cube([2, 2, 2]).translate([6, 6, 6])]),
      // A sealed cavity: the inner shell is an inside-out (negative-volume)
      // piece and nothing needs a ray test.
      hollow: M.cube([20, 20, 20], true).subtract(M.cube([10, 10, 10], true)),
      rattle: M.compose([M.cube([20, 20, 20], true).subtract(M.cube([10, 10, 10], true)), M.sphere(3, 32)]),
    };
    const want: Record<string, { count: number; contained: number }> = {
      disjoint: { count: 2, contained: 0 },
      enclosed: { count: 2, contained: 1 },
      overlapping: { count: 2, contained: 0 },
      sideBySideInBox: { count: 3, contained: 2 },
      hollow: { count: 2, contained: 1 },
      rattle: { count: 3, contained: 2 },
    };
    for (const [name, m] of Object.entries(cases)) {
      const { exact, fromMesh } = both(m);
      expect({ name, count: fromMesh.componentCount, contained: fromMesh.containedComponents }).toEqual({ name, ...{ count: want[name].count, contained: want[name].contained } });
      expect(fromMesh.componentCount).toBe(exact.componentCount);
      expect(fromMesh.containedComponents).toBe(exact.containedComponents);
      expect(fromMesh.componentsInterpenetrate).toBe(exact.componentsInterpenetrate);
      expect(fromMesh.volume).toBeCloseTo(exact.volume, 6);
      expect(fromMesh.pieces?.count).toBe(exact.componentCount);
      expect(fromMesh.edges?.min).toBeGreaterThan(0);
    }
  });
});
