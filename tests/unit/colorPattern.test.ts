import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import { computePatternColors, filterScopeTriangles, COLOR_PATTERN_KINDS, type RGB } from '../../src/color/colorPattern';

/** Axis-aligned cube spanning [0,s]^3 (8 verts / 12 tris). */
function cube(s = 10): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0,
    0, 0, s, s, 0, s, s, s, s, 0, s, s,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
  ]);
  return { vertProperties, triVerts, numVert: 8, numTri: 12, numProp: 3 };
}

const all = (m: MeshData): Set<number> => new Set(Array.from({ length: m.numTri }, (_, i) => i));
const BASE: RGB = [1, 0, 0];
const MARK: RGB = [0, 0, 1];

describe('colorPattern', () => {
  it('assigns every scoped triangle one of the palette colors', () => {
    const m = cube();
    for (const pattern of COLOR_PATTERN_KINDS) {
      const colors = computePatternColors(m, all(m), { pattern, colors: [BASE, MARK] });
      expect(colors.size).toBe(m.numTri);
      for (const c of colors.values()) {
        // each triangle is exactly the base or the mark colour (no blending)
        const isBase = c[0] === BASE[0] && c[1] === BASE[1] && c[2] === BASE[2];
        const isMark = c[0] === MARK[0] && c[1] === MARK[1] && c[2] === MARK[2];
        expect(isBase || isMark).toBe(true);
      }
    }
  });

  it('stripes produce both colors over a span (not a single flat fill)', () => {
    const m = cube(40);
    const colors = computePatternColors(m, all(m), { pattern: 'stripes', colors: [BASE, MARK], axis: 'z', scale: 6, warp: 0 });
    const distinct = new Set([...colors.values()].map((c) => c.join(',')));
    expect(distinct.size).toBe(2);
  });

  it('patches can use a third color', () => {
    const m = cube(60);
    const THIRD: RGB = [0, 1, 0];
    const colors = computePatternColors(m, all(m), { pattern: 'patches', colors: [BASE, MARK, THIRD], scale: 8 });
    const used = new Set([...colors.values()].map((c) => c.join(',')));
    // at least two of the three tones appear on a 12-tri cube; the third may or may not
    expect(used.size).toBeGreaterThanOrEqual(2);
  });

  it('filterScopeTriangles narrows by an above/below plane', () => {
    const m = cube(10);
    const base = all(m);
    const above = filterScopeTriangles(m, base, { above: { axis: 'z', at: 5 } });
    const below = filterScopeTriangles(m, base, { below: { axis: 'z', at: 5 } });
    // the split is disjoint and covers everything (no centroid sits exactly on z=5)
    expect(above.size).toBeGreaterThan(0);
    expect(below.size).toBeGreaterThan(0);
    expect(above.size + below.size).toBe(m.numTri);
    for (const t of above) expect(below.has(t)).toBe(false);
  });

  it('filterScopeTriangles narrows by a box and a sphere', () => {
    const m = cube(10);
    const base = all(m);
    const boxed = filterScopeTriangles(m, base, { box: { min: [-1, -1, -1], max: [11, 11, 11] } });
    expect(boxed.size).toBe(m.numTri); // box contains the whole cube
    const tiny = filterScopeTriangles(m, base, { box: { min: [100, 100, 100], max: [101, 101, 101] } });
    expect(tiny.size).toBe(0);
    const sphere = filterScopeTriangles(m, base, { sphere: { center: [5, 5, 5], radius: 100 } });
    expect(sphere.size).toBe(m.numTri);
  });

  it('returns the base set unchanged when no geometric predicate is present', () => {
    const m = cube();
    const base = all(m);
    expect(filterScopeTriangles(m, base, { label: 'body' })).toBe(base);
    expect(filterScopeTriangles(m, base, undefined)).toBe(base);
  });
});
