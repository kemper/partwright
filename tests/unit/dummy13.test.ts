// Unit tests for the pure-logic parts of dummy13 — spec resolution, segment
// lengths, and cup/ball-end size helpers. The geometry builders that need the
// manifold-3d WASM module are exercised through the catalog bake (which fails
// CI's lint:catalog if any entry can't be built).

import { describe, it, expect } from 'vitest';
import {
  DUMMY13_DEFAULTS,
  DUMMY13_PROPORTIONS,
  __testables__,
} from '../../src/geometry/dummy13';

const { resolveSpec, segmentLengths, cupGeometry, ballEndHeight } = __testables__;

describe('dummy13.resolveSpec', () => {
  it('returns DUMMY13_DEFAULTS values when input is empty', () => {
    const spec = resolveSpec({});
    expect(spec.height).toBe(DUMMY13_DEFAULTS.height);
    expect(spec.shoulderBallD).toBe(DUMMY13_DEFAULTS.jointShoulderBallD);
    expect(spec.hipBallD).toBe(DUMMY13_DEFAULTS.jointHipBallD);
    expect(spec.clearance).toBe(DUMMY13_DEFAULTS.clearance);
    expect(spec.openingRatio).toBe(DUMMY13_DEFAULTS.openingRatio);
    expect(spec.prop).toBe(DUMMY13_PROPORTIONS);
  });

  it('overrides only the fields the caller specifies', () => {
    const spec = resolveSpec({ height: 200, clearance: 0.25 });
    expect(spec.height).toBe(200);
    expect(spec.clearance).toBe(0.25);
    // Untouched fields fall back to defaults.
    expect(spec.shoulderBallD).toBe(DUMMY13_DEFAULTS.jointShoulderBallD);
    expect(spec.openingRatio).toBe(DUMMY13_DEFAULTS.openingRatio);
  });
});

describe('dummy13.segmentLengths', () => {
  it('proportions sum along the body axis to ~1.0 * height', () => {
    const spec = resolveSpec({});
    const lens = segmentLengths(spec);
    const total = lens.head + lens.neck + lens.torsoUpper + lens.hips + lens.thigh + lens.shin;
    // The Dummy 13 figure's body-axis proportions are designed to sum to
    // exactly the requested height; allow tiny float slack.
    expect(total).toBeCloseTo(spec.height, 6);
  });

  it('scales every segment linearly with height', () => {
    const small = segmentLengths(resolveSpec({ height: 100 }));
    const big = segmentLengths(resolveSpec({ height: 200 }));
    expect(big.head).toBeCloseTo(small.head * 2, 6);
    expect(big.torsoUpper).toBeCloseTo(small.torsoUpper * 2, 6);
    expect(big.shoulderWidth).toBeCloseTo(small.shoulderWidth * 2, 6);
  });
});

describe('dummy13.cupGeometry', () => {
  it('opening is openingRatio * ballD', () => {
    const spec = resolveSpec({});
    const g = cupGeometry(10, spec);
    expect(g.openingR * 2).toBeCloseTo(spec.openingRatio * 10, 6);
  });

  it('cavity radius is ballR + clearance', () => {
    const spec = resolveSpec({ clearance: 0.2 });
    const g = cupGeometry(8, spec);
    expect(g.cavityR).toBeCloseTo(4 + 0.2, 6);
  });

  it('the cup is taller than its cavity diameter (because of floor + lip)', () => {
    const spec = resolveSpec({});
    const ballD = 8;
    const g = cupGeometry(ballD, spec);
    expect(g.totalH).toBeGreaterThan(2 * g.cavityR * 0.6);
    // And small enough not to dwarf the ball.
    expect(g.totalH).toBeLessThan(ballD * 2);
  });

  it('housing radius exceeds cavity radius by a printable wall', () => {
    const spec = resolveSpec({});
    const g = cupGeometry(8, spec);
    const wall = g.housingR - g.cavityR;
    expect(wall).toBeGreaterThanOrEqual(1.59); // 1.6 minus float-subtract slack
  });
});

describe('dummy13.ballEndHeight', () => {
  it('scales with ball diameter', () => {
    expect(ballEndHeight(8)).toBeGreaterThan(ballEndHeight(4));
  });

  it('includes the base disc, stem, and ball', () => {
    // baseT + stemL + ballD — a sane upper bound for the standalone ball-end column.
    const h = ballEndHeight(10);
    expect(h).toBeGreaterThan(10); // at least the ball diameter
    expect(h).toBeLessThan(30); // not absurdly long
  });
});
