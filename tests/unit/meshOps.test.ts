// Unit tests for the pure-logic parts of meshOps — the bits that don't need
// the manifold-3d WASM module (validation helpers, alignment-offset math,
// plane/axis parsing). The geometry-touching helpers (intersects, placeOn,
// circularPattern…) are exercised in the e2e tier where the real WASM runs.

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/meshOps';

const { alignOffset, parsePlaneNormal, parseAxis, isVec3, resolveAlignTargetPure } = __testables__;

describe('meshOps.alignOffset', () => {
  it('returns 0 when mode is undefined (no-op)', () => {
    expect(alignOffset(0, 10, 0, 100, undefined)).toBe(0);
  });

  it('"min" snaps shape.min to target.min', () => {
    // Shape spans [3, 13], target spans [0, 100]. Want shape's min to land at 0 → shift by -3.
    expect(alignOffset(3, 13, 0, 100, 'min')).toBe(-3);
  });

  it('"max" snaps shape.max to target.max', () => {
    // Shape spans [3, 13], target spans [0, 100]. Want shape's max at 100 → shift by 87.
    expect(alignOffset(3, 13, 0, 100, 'max')).toBe(87);
  });

  it('"center" puts shape center on target center', () => {
    // Shape center 8, target center 50 → shift 42.
    expect(alignOffset(3, 13, 0, 100, 'center')).toBe(42);
  });

  it('directional aliases map onto min/max', () => {
    expect(alignOffset(3, 13, 0, 100, 'left')).toBe(alignOffset(3, 13, 0, 100, 'min'));
    expect(alignOffset(3, 13, 0, 100, 'bottom')).toBe(alignOffset(3, 13, 0, 100, 'min'));
    expect(alignOffset(3, 13, 0, 100, 'right')).toBe(alignOffset(3, 13, 0, 100, 'max'));
    expect(alignOffset(3, 13, 0, 100, 'top')).toBe(alignOffset(3, 13, 0, 100, 'max'));
  });

  it('rejects unknown modes with a clear error', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => alignOffset(0, 1, 0, 1, 'middle' as any)).toThrow(/unknown mode/);
  });
});

describe('meshOps.parsePlaneNormal', () => {
  it('accepts axis strings', () => {
    expect(parsePlaneNormal('x', 'test')).toEqual([1, 0, 0]);
    expect(parsePlaneNormal('y', 'test')).toEqual([0, 1, 0]);
    expect(parsePlaneNormal('z', 'test')).toEqual([0, 0, 1]);
    // Case-insensitive for the single-letter form.
    expect(parsePlaneNormal('Z', 'test')).toEqual([0, 0, 1]);
  });

  it('accepts explicit Vec3 normals', () => {
    expect(parsePlaneNormal([1, 1, 0], 'test')).toEqual([1, 1, 0]);
  });

  it('rejects garbage', () => {
    expect(() => parsePlaneNormal('diagonal', 'test')).toThrow(/plane must be/);
    expect(() => parsePlaneNormal([1, 2], 'test')).toThrow(/plane must be/);
    expect(() => parsePlaneNormal(null, 'test')).toThrow(/plane must be/);
  });
});

describe('meshOps.parseAxis', () => {
  it('defaults to Z when undefined', () => {
    expect(parseAxis(undefined, 'test')).toEqual([0, 0, 1]);
  });

  it('normalizes Vec3 axes', () => {
    const a = parseAxis([2, 0, 0], 'test');
    expect(a[0]).toBeCloseTo(1, 6);
    expect(a[1]).toBeCloseTo(0, 6);
    expect(a[2]).toBeCloseTo(0, 6);
  });

  it('rejects a zero-length axis', () => {
    expect(() => parseAxis([0, 0, 0], 'test')).toThrow(/non-zero length/);
  });
});

describe('meshOps.resolveAlignTargetPure', () => {
  it("'origin' returns a zero-extent bbox at world (0,0,0)", () => {
    const r = resolveAlignTargetPure('origin', 'test');
    expect(r.min).toEqual([0, 0, 0]);
    expect(r.max).toEqual([0, 0, 0]);
    expect(r.size).toEqual([0, 0, 0]);
    expect(r.center).toEqual([0, 0, 0]);
  });

  it('accepts a bbox literal and computes size/center', () => {
    const r = resolveAlignTargetPure({ min: [-5, 0, 10], max: [5, 10, 20] }, 'test');
    expect(r.size).toEqual([10, 10, 10]);
    expect(r.center).toEqual([0, 5, 15]);
  });

  it('rejects malformed targets with a clear message', () => {
    expect(() => resolveAlignTargetPure(undefined, 'test')).toThrow(/target must be/);
    expect(() => resolveAlignTargetPure({ min: [1, 2], max: [3, 4] }, 'test')).toThrow(/3-element min\/max/);
    expect(() => resolveAlignTargetPure({ min: [1, 2, NaN], max: [3, 4, 5] }, 'test')).toThrow(/finite numbers/);
  });
});

describe('meshOps.isVec3', () => {
  it('accepts a real 3-tuple of finite numbers', () => {
    expect(isVec3([1, 2, 3])).toBe(true);
    expect(isVec3([0, 0, 0])).toBe(true);
  });

  it('rejects NaN/Infinity, wrong arity, strings', () => {
    expect(isVec3([1, 2])).toBe(false);
    expect(isVec3([1, 2, 3, 4])).toBe(false);
    expect(isVec3([1, NaN, 3])).toBe(false);
    expect(isVec3([1, Infinity, 3])).toBe(false);
    expect(isVec3('1,2,3')).toBe(false);
    expect(isVec3(null)).toBe(false);
  });
});
