// Unit tests for src/geometry/lsystem.ts — the L-system rewriter and 3D
// turtle interpreter that back api.sdf.lsystem(). Pure logic, no WASM.

import { describe, it, expect } from 'vitest';
import { expandLSystem, turtle3d } from '../../src/geometry/lsystem';

describe('expandLSystem', () => {
  it('returns the axiom unchanged at 0 iterations', () => {
    expect(expandLSystem({ axiom: 'ABC', rules: { A: 'X' }, iterations: 0 })).toBe('ABC');
  });

  it('rewrites the classic algae system deterministically', () => {
    // A -> AB, B -> A  ⇒  A, AB, ABA, ABAAB, ABAABABA
    const spec = { axiom: 'A', rules: { A: 'AB', B: 'A' } };
    expect(expandLSystem({ ...spec, iterations: 1 })).toBe('AB');
    expect(expandLSystem({ ...spec, iterations: 2 })).toBe('ABA');
    expect(expandLSystem({ ...spec, iterations: 3 })).toBe('ABAAB');
    expect(expandLSystem({ ...spec, iterations: 4 })).toBe('ABAABABA');
  });

  it('passes through symbols with no rule', () => {
    expect(expandLSystem({ axiom: 'F+F', rules: { F: 'FF' }, iterations: 1 })).toBe('FF+FF');
  });

  it('resolves stochastic rules reproducibly for a fixed seed', () => {
    // X persists each pass (…X), accumulating a random A or B per iteration.
    const spec = {
      axiom: 'X',
      rules: { X: [{ p: 1, to: 'AX' }, { p: 1, to: 'BX' }] },
      iterations: 10,
    };
    const a = expandLSystem({ ...spec, seed: 123 });
    const b = expandLSystem({ ...spec, seed: 123 });
    expect(a).toBe(b);
    // Over 10 independent draws both branches should appear.
    expect(a).toMatch(/A/);
    expect(a).toMatch(/B/);
  });

  it('different seeds give different stochastic expansions', () => {
    const spec = {
      axiom: 'X',
      rules: { X: [{ p: 1, to: 'AX' }, { p: 1, to: 'BX' }] },
      iterations: 12,
    };
    expect(expandLSystem({ ...spec, seed: 1 })).not.toBe(expandLSystem({ ...spec, seed: 2 }));
  });

  it('throws if expansion blows past the safety cap', () => {
    expect(() => expandLSystem({ axiom: 'F', rules: { F: 'FFFFFFFFFF' }, iterations: 20 }))
      .toThrow(/exceeded/);
  });
});

describe('turtle3d', () => {
  it('draws a single F as a segment up the +Z axis', () => {
    const { segments } = turtle3d('F', { length: 8, radius: 2 });
    expect(segments).toHaveLength(1);
    expect(segments[0].a).toEqual([0, 0, 0]);
    expect(segments[0].b[0]).toBeCloseTo(0);
    expect(segments[0].b[1]).toBeCloseTo(0);
    expect(segments[0].b[2]).toBeCloseTo(8);
    expect(segments[0].radius).toBeCloseTo(2);
    expect(segments[0].depth).toBe(0);
  });

  it('chains F segments end to end', () => {
    const { segments } = turtle3d('FF', { length: 5 });
    expect(segments).toHaveLength(2);
    expect(segments[0].b).toEqual(segments[1].a);
    expect(segments[1].b[2]).toBeCloseTo(10);
  });

  it('lowercase f moves without drawing', () => {
    const { segments } = turtle3d('fF', { length: 4 });
    expect(segments).toHaveLength(1);
    expect(segments[0].a[2]).toBeCloseTo(4); // started after the gap
    expect(segments[0].b[2]).toBeCloseTo(8);
  });

  it('tracks branch depth and restores state on pop', () => {
    // Trunk, branch (depth 1), back to trunk.
    const { segments } = turtle3d('F[+F]F', { length: 3, angle: 90 });
    expect(segments).toHaveLength(3);
    expect(segments[0].depth).toBe(0);
    expect(segments[1].depth).toBe(1);
    expect(segments[2].depth).toBe(0);
    // After the pop, the trunk continues from the end of the first segment.
    expect(segments[2].a).toEqual(segments[0].b);
  });

  it('applies radius taper by depth', () => {
    const { segments } = turtle3d('F[+F]', { length: 3, radius: 4, radiusScale: 0.5, angle: 30 });
    expect(segments[0].radius).toBeCloseTo(4);      // depth 0
    expect(segments[1].radius).toBeCloseTo(2);      // depth 1 → 4 * 0.5
  });

  it('records leaf markers at the current position', () => {
    const { segments, leaves } = turtle3d('FL', { length: 6, leafSymbols: ['L'] });
    expect(segments).toHaveLength(1);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].p[2]).toBeCloseTo(6); // at the tip of the segment
  });

  it('+ and - turns are inverse', () => {
    const { segments } = turtle3d('F+F-F', { length: 2, angle: 35 });
    // First and third headings match (turn then unturn), so segment 0 and 2
    // are parallel — their direction vectors are equal.
    const dir = (s: typeof segments[number]) =>
      [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]] as const;
    const d0 = dir(segments[0]), d2 = dir(segments[2]);
    for (let i = 0; i < 3; i++) expect(d2[i]).toBeCloseTo(d0[i]);
  });
});
