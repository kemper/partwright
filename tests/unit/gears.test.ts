// Unit tests for the pure-logic parts of the gears namespace — the involute
// math, gear dimensions, and the 2-D outline generators. The Manifold builders
// that need the manifold-3d WASM kernel are exercised in the e2e tier
// (tests/gears-threads.spec.ts).

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/gears';

const { involute, gearDimensions, centerDistance, gearRatio, spurOutline, rackOutline } = __testables__;

const hypot = (p: [number, number]) => Math.hypot(p[0], p[1]);

describe('gears involute math', () => {
  it('inv(α) = tan(α) − α and is 0 at the base circle', () => {
    expect(involute(0)).toBe(0);
    // inv(20°) ≈ 0.014904 — the standard reference value.
    expect(involute((20 * Math.PI) / 180)).toBeCloseTo(0.0149044, 5);
  });

  it('is monotonically increasing', () => {
    let prev = -1;
    for (let a = 0; a < 1.2; a += 0.1) {
      const v = involute(a);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('gears dimensions', () => {
  it('pitch radius = module · teeth / 2 with base < pitch, root < pitch < tip', () => {
    const d = gearDimensions(2, 20, 20, 0.25);
    expect(d.pitchR).toBe(20);
    expect(d.baseR).toBeLessThan(d.pitchR);
    expect(d.tipR).toBe(22); // pitchR(20) + addendum(=module=2)
    expect(d.rootR).toBeLessThan(d.pitchR);
    expect(d.rootR).toBeGreaterThan(0);
    expect(d.circularPitch).toBeCloseTo(Math.PI * 2, 6);
  });

  it('center distance is the average of the two pitch radii', () => {
    // module 2, 12 + 24 teeth → pitch radii 12 and 24 → centre distance 36.
    expect(centerDistance(12, 24, 2)).toBe(36);
  });

  it('gear ratio is driven / driver', () => {
    expect(gearRatio(12, 24)).toBe(2);
    expect(gearRatio(20, 10)).toBe(0.5);
  });
});

describe('gears spurOutline', () => {
  it('produces two flank polylines per tooth, all within [root, tip]', () => {
    const teeth = 16;
    const steps = 8;
    const pts = spurOutline({ module: 2, teeth, steps });
    // Each tooth contributes (steps+1) left-flank + (steps+1) right-flank points.
    expect(pts.length).toBe(teeth * 2 * (steps + 1));
    const d = gearDimensions(2, teeth, 20, 0.25);
    for (const p of pts) {
      const r = hypot(p);
      expect(r).toBeGreaterThanOrEqual(d.rootR - 1e-6);
      expect(r).toBeLessThanOrEqual(d.tipR + 1e-6);
    }
  });

  it('teeth are evenly distributed around the full circle', () => {
    const pts = spurOutline({ module: 1.5, teeth: 24, steps: 6 });
    // The outline must span all four quadrants (angles cover 0..2π).
    const angles = pts.map((p) => Math.atan2(p[1], p[0]));
    expect(Math.max(...angles)).toBeGreaterThan(2.5);
    expect(Math.min(...angles)).toBeLessThan(-2.5);
  });

  it('rejects backlash that would erase the teeth', () => {
    expect(() => spurOutline({ module: 1, teeth: 8, backlash: 100 })).toThrow();
  });
});

describe('gears rackOutline', () => {
  it('runs from x=0 to length = teeth · circular pitch', () => {
    const teeth = 5;
    const module = 2;
    const pts = rackOutline({ module, teeth });
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(teeth * Math.PI * module, 6);
  });

  it('tooth tips reach the addendum (+module) above the pitch line', () => {
    const pts = rackOutline({ module: 2, teeth: 3 });
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(2, 6); // addendum = module
  });
});
