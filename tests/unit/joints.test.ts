// Unit tests for the pure-logic parts of joints — the dovetail profile, the
// hinge knuckle layout, the ball-socket dimensioning, and the snap-rim profile.
// The geometry builders that need the manifold-3d WASM module are exercised in
// the e2e tier (tests/print-fit.spec.ts), where the real kernel runs.

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/joints';

const { dovetailProfile, hingeKnuckleIntervals, ballSocketDims, snapRimProfile } = __testables__;

describe('joints.dovetailProfile', () => {
  it('is narrow at the mouth and wider into the material', () => {
    const p = dovetailProfile(10, 5, 15);
    const mouthWidth = Math.abs(p[1][0] - p[0][0]); // y=0 edge
    const backWidth = Math.abs(p[2][0] - p[3][0]);  // y=depth edge
    expect(mouthWidth).toBeCloseTo(10, 6);
    expect(backWidth).toBeGreaterThan(mouthWidth); // dovetail retains
  });

  it('flare grows with angle', () => {
    const shallow = dovetailProfile(10, 5, 5);
    const steep = dovetailProfile(10, 5, 25);
    const shallowBack = Math.abs(shallow[2][0] - shallow[3][0]);
    const steepBack = Math.abs(steep[2][0] - steep[3][0]);
    expect(steepBack).toBeGreaterThan(shallowBack);
  });

  it('depth reaches the requested value', () => {
    const p = dovetailProfile(10, 7, 15);
    expect(p[2][1]).toBeCloseTo(7, 6);
    expect(p[3][1]).toBeCloseTo(7, 6);
  });
});

describe('joints.hingeKnuckleIntervals', () => {
  it('tiles the width exactly: first starts at 0, last ends at width', () => {
    const layout = hingeKnuckleIntervals(30, 5, 0.3);
    expect(layout).toHaveLength(5);
    expect(layout[0].start).toBeCloseTo(0, 9);
    expect(layout[layout.length - 1].end).toBeCloseTo(30, 9);
  });

  it('separates adjacent knuckles by exactly the clearance gap', () => {
    const layout = hingeKnuckleIntervals(30, 5, 0.3);
    for (let i = 1; i < layout.length; i++) {
      expect(layout[i].start - layout[i - 1].end).toBeCloseTo(0.3, 9);
    }
  });

  it('makes all knuckles the same length, summing with gaps to the width', () => {
    const layout = hingeKnuckleIntervals(25, 7, 0.25);
    const lengths = layout.map((k) => k.end - k.start);
    for (const len of lengths) expect(len).toBeCloseTo(lengths[0], 9);
    const total = lengths.reduce((a, b) => a + b, 0) + 6 * 0.25;
    expect(total).toBeCloseTo(25, 9);
  });

  it('alternates ownership starting and ending with the pin leaf (owner 0)', () => {
    const layout = hingeKnuckleIntervals(30, 5, 0.3);
    expect(layout.map((k) => k.owner)).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('joints.ballSocketDims', () => {
  it('keeps the opening smaller than the ball for every valid openingRatio', () => {
    for (let ratio = 0.7; ratio <= 0.951; ratio += 0.05) {
      const d = ballSocketDims(10, 0.15, Math.min(ratio, 0.95));
      expect(d.openingR * 2).toBeLessThan(10); // ball stays captive
      expect(d.openingR).toBeLessThan(d.cavityR); // a retention lip exists
    }
  });

  it('cavity carries the clearance over the ball', () => {
    const d = ballSocketDims(10, 0.15, 0.85);
    expect(d.ballR).toBeCloseTo(5, 9);
    expect(d.cavityR).toBeCloseTo(5.15, 9);
  });

  it('lip height satisfies the chord relation openingR² + lipH² = cavityR²', () => {
    const d = ballSocketDims(12, 0.2, 0.8);
    expect(d.openingR ** 2 + d.lipH ** 2).toBeCloseTo(d.cavityR ** 2, 9);
    expect(d.lipH).toBeGreaterThan(0);
  });
});

describe('joints.snapRimProfile', () => {
  it('builds a closed circle of the bead radius centred at the ring radius', () => {
    const R = 20;
    const r = 0.6;
    const pts = snapRimProfile(R, r);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - R, y)).toBeCloseTo(r, 9);
    }
  });

  it('keeps every vertex at positive radius when R > r (revolve-safe)', () => {
    const pts = snapRimProfile(5, 1.2);
    for (const [x] of pts) expect(x).toBeGreaterThan(0);
  });

  it('groove profile (bead radius + clearance) strictly contains the bead profile', () => {
    const R = 15;
    const bead = snapRimProfile(R, 0.6);
    const groove = snapRimProfile(R, 0.6 + 0.15);
    const maxBead = Math.max(...bead.map(([x]) => x));
    const maxGroove = Math.max(...groove.map(([x]) => x));
    expect(maxGroove).toBeGreaterThan(maxBead);
  });
});
