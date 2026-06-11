// Unit tests for the pure-logic part of the enclosure namespace — the
// rounded-rectangle outline generator. The Manifold builders (shell/box/
// standoff) that need the manifold-3d WASM kernel are exercised headlessly via
// `npm run model:preview` and in the e2e tier.

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/enclosure';

const { roundedRectPts } = __testables__;

describe('enclosure roundedRectPts', () => {
  it('returns a plain 4-corner rectangle when radius is ~0', () => {
    const pts = roundedRectPts(20, 10, 0);
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) {
      expect(Math.abs(x)).toBeCloseTo(10, 6);
      expect(Math.abs(y)).toBeCloseTo(5, 6);
    }
  });

  it('rounds with 4 corner arcs of (seg+1) points each', () => {
    const seg = 8;
    const pts = roundedRectPts(40, 30, 5, seg);
    expect(pts).toHaveLength(4 * (seg + 1));
  });

  it('keeps every point inside the outer half-extents', () => {
    const w = 40, h = 30, r = 6;
    for (const [x, y] of roundedRectPts(w, h, r, 12)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(h / 2 + 1e-9);
    }
  });

  it('clamps an over-large radius to half the shorter side (stays a valid outline)', () => {
    // r far bigger than the box → clamp to min(w,h)/2; no point escapes bounds.
    const w = 20, h = 10;
    for (const [x, y] of roundedRectPts(w, h, 999, 8)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(h / 2 + 1e-9);
    }
  });

  it('is symmetric about both axes', () => {
    const pts = roundedRectPts(30, 20, 4, 6);
    const sumX = pts.reduce((a, [x]) => a + x, 0);
    const sumY = pts.reduce((a, [, y]) => a + y, 0);
    expect(sumX).toBeCloseTo(0, 6);
    expect(sumY).toBeCloseTo(0, 6);
  });
});
