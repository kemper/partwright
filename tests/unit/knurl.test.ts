// Unit tests for the pure-logic parts of the knurl namespace — the ridge-count
// and twist math, and the cog / rib profile generators. The Manifold builders
// (diamond/straight/ribs) that need the manifold-3d WASM kernel are exercised
// headlessly via `npm run model:preview` and in the e2e tier.

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/knurl';

const { colsFor, knurlTwist, cogProfile, ribProfile } = __testables__;

const hypot = (p: [number, number]) => Math.hypot(p[0], p[1]);

describe('knurl colsFor', () => {
  it('is circumference / pitch, rounded', () => {
    // π·24 / 2 ≈ 37.7 → 38
    expect(colsFor(24, 2)).toBe(38);
  });
  it('never drops below 6 ridges', () => {
    expect(colsFor(3, 5)).toBe(6);
  });
});

describe('knurl knurlTwist', () => {
  it('is 360·H / (π·D) for a square diamond', () => {
    expect(knurlTwist(24, 18, 1)).toBeCloseTo((360 * 18) / (Math.PI * 24), 6);
  });
  it('scales inversely with aspect (taller diamonds = less twist)', () => {
    expect(knurlTwist(24, 18, 2)).toBeCloseTo(knurlTwist(24, 18, 1) / 2, 6);
  });
});

describe('knurl cogProfile', () => {
  it('keeps every vertex radius within [rootR, outerR]', () => {
    const root = 11, outer = 12;
    const pts = cogProfile(root, outer, 16);
    for (const p of pts) {
      const r = hypot(p);
      expect(r).toBeGreaterThanOrEqual(root - 1e-9);
      expect(r).toBeLessThanOrEqual(outer + 1e-9);
    }
  });
  it('reaches the peak radius at least once (ridges are full-depth)', () => {
    const pts = cogProfile(11, 12, 16);
    const maxR = Math.max(...pts.map(hypot));
    expect(maxR).toBeCloseTo(12, 4);
  });
  it('emits cols·samplesPerTooth vertices', () => {
    expect(cogProfile(11, 12, 16, 6)).toHaveLength(16 * 6);
  });
});

describe('knurl ribProfile', () => {
  it('starts and ends on the axis (x=0) so the revolve closes solid', () => {
    const pts = ribProfile(11, 12, 20, 8);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([0, 20]);
  });
  it('stays in the x >= 0 half-plane within [rootR, outerR]', () => {
    for (const [x] of ribProfile(11, 12, 20, 8)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(12 + 1e-9);
    }
  });
});
