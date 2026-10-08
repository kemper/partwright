import { describe, it, expect } from 'vitest';
import {
  makeWrapFn,
  makeBendFn,
  makeTwistFn,
  makeTaperFn,
  buildCurveFrames,
  makeAlongCurveFn,
  type Vec3,
} from '../../src/geometry/deform';
import { falloff, makeGrabFn, makeInflateFn, makeFlattenFn } from '../../src/geometry/sculpt';
import { sampleMeshSurface, instanceMatrix, type MeshLike } from '../../src/geometry/scatter';

const apply = (fn: (v: number[]) => void, p: Vec3): Vec3 => {
  const v = [...p];
  fn(v);
  return v as Vec3;
};

describe('makeWrapFn', () => {
  const r = 10;
  const wrap = makeWrapFn(r, 0);

  it('maps x=0, y=0 to the front of the cylinder (−Y) preserving z', () => {
    const [x, y, z] = apply(wrap, [0, 0, 7]);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-r, 9);
    expect(z).toBe(7);
  });

  it('preserves arc length at y=0 and radial offset at y≠0', () => {
    const quarter = (Math.PI / 2) * r; // arc length for 90°
    const [x, y] = apply(wrap, [quarter, 0, 0]);
    expect(x).toBeCloseTo(r, 6);
    expect(y).toBeCloseTo(0, 6);
    const [x2, y2] = apply(wrap, [0, 2, 0]);
    expect(Math.hypot(x2, y2)).toBeCloseTo(r + 2, 9);
  });
});

describe('makeBendFn', () => {
  it('keeps the segment center fixed and curls the ends symmetrically toward +Y', () => {
    const bend = makeBendFn(-30, 30, 0, Math.PI / 2); // 90° bend
    const mid = apply(bend, [0, 0, 5]);
    expect(mid[0]).toBeCloseTo(0, 9);
    expect(mid[1]).toBeCloseTo(0, 9);
    expect(mid[2]).toBe(5);
    const endA = apply(bend, [30, 0, 0]);
    const endB = apply(bend, [-30, 0, 0]);
    expect(endA[1]).toBeGreaterThan(0);
    expect(endA[1]).toBeCloseTo(endB[1], 9);
    expect(endA[0]).toBeCloseTo(-endB[0], 9);
  });

  it('preserves arc length on the reference line', () => {
    const angle = Math.PI / 3;
    const bend = makeBendFn(0, 60, 0, angle);
    const R = 60 / angle;
    const end = apply(bend, [60, 0, 0]);
    // End sits at angle/2 past center on the arc of radius R centered at (30, R).
    expect(Math.hypot(end[0] - 30, end[1] - R)).toBeCloseTo(R, 6);
  });
});

describe('makeTwistFn', () => {
  it('rotates 0 at the bottom and the full angle at the top', () => {
    const twist = makeTwistFn(2, 0, 10, Math.PI / 2);
    const bottom = apply(twist, [3, 0, 0]);
    expect(bottom[0]).toBeCloseTo(3, 9);
    expect(bottom[1]).toBeCloseTo(0, 9);
    const top = apply(twist, [3, 0, 10]);
    expect(top[0]).toBeCloseTo(0, 6);
    expect(top[1]).toBeCloseTo(3, 6);
    expect(top[2]).toBe(10);
  });
});

describe('makeTaperFn', () => {
  it('scales the perpendicular plane linearly along the axis about the center', () => {
    const taper = makeTaperFn(2, 0, 10, [1, 1], [0.5, 0.25], 0, 0);
    const bottom = apply(taper, [4, 4, 0]);
    expect(bottom[0]).toBeCloseTo(4, 9);
    const top = apply(taper, [4, 4, 10]);
    expect(top[0]).toBeCloseTo(2, 9);
    expect(top[1]).toBeCloseTo(1, 9);
    const mid = apply(taper, [4, 0, 5]);
    expect(mid[0]).toBeCloseTo(3, 9); // lerp(1, 0.5, 0.5) = 0.75 → 4·0.75
  });
});

describe('buildCurveFrames + makeAlongCurveFn', () => {
  it('builds orthonormal frames with cumulative arc length', () => {
    const frames = buildCurveFrames([[0, 0, 0], [10, 0, 0], [10, 10, 0]], [0, 0, 1]);
    expect(frames).toHaveLength(3);
    expect(frames[2].s).toBeCloseTo(20, 9);
    for (const f of frames) {
      expect(Math.hypot(...f.t)).toBeCloseTo(1, 6);
      expect(Math.hypot(...f.n)).toBeCloseTo(1, 6);
      expect(f.t[0] * f.n[0] + f.t[1] * f.n[1] + f.t[2] * f.n[2]).toBeCloseTo(0, 6);
    }
  });

  it('maps a straight strip onto a straight curve identically', () => {
    const frames = buildCurveFrames([[0, 0, 0], [20, 0, 0]], [0, 0, 1]);
    const fn = makeAlongCurveFn(frames, 0);
    const p = apply(fn, [5, 1, 2]);
    // Tangent +X, normal = up with tangential removed = +Z, binormal = t×n = −Y.
    expect(p[0]).toBeCloseTo(5, 9);
    expect(p[2]).toBeCloseTo(1, 6);  // +Y offset rides the normal (+Z)
    expect(p[1]).toBeCloseTo(-2, 6); // +Z offset rides the binormal (−Y)
  });

  it('extends straight beyond the curve ends', () => {
    const frames = buildCurveFrames([[0, 0, 0], [10, 0, 0]], [0, 0, 1]);
    const fn = makeAlongCurveFn(frames, 0);
    const past = apply(fn, [15, 0, 0]);
    expect(past[0]).toBeCloseTo(15, 6);
    expect(past[1]).toBeCloseTo(0, 6);
  });
});

describe('sculpt displacement builders', () => {
  it('falloff is 1 at center, 0 at the rim, monotonic', () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(1)).toBe(0);
    expect(falloff(0.3)).toBeGreaterThan(falloff(0.7));
  });

  it('grab moves the center by the full offset and leaves the rim untouched', () => {
    const grab = makeGrabFn([0, 0, 0], 5, [2, 0, 0]);
    expect(apply(grab, [0, 0, 0])[0]).toBeCloseTo(2, 9);
    expect(apply(grab, [5, 0, 0])[0]).toBeCloseTo(5, 9);
    expect(apply(grab, [9, 0, 0])[0]).toBe(9);
  });

  it('inflate pushes radially away; negative amount dents', () => {
    const inflate = makeInflateFn([0, 0, 0], 10, 3);
    const p = apply(inflate, [2, 0, 0]);
    expect(p[0]).toBeGreaterThan(2);
    const dent = makeInflateFn([0, 0, 0], 10, -1);
    expect(apply(dent, [2, 0, 0])[0]).toBeLessThan(2);
    // Exact center has no direction — unchanged.
    expect(apply(inflate, [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('flatten projects toward the plane at full strength in the center', () => {
    const flatten = makeFlattenFn([0, 0, 0], 10, [0, 0, 1], 1);
    const p = apply(flatten, [0, 0, 3]);
    expect(p[2]).toBeCloseTo(0, 9);
    const rim = apply(flatten, [10, 0, 3]);
    expect(rim[2]).toBe(3);
  });
});

describe('scatter sampling', () => {
  const quad: MeshLike = {
    // Two triangles forming the unit-Z plane square [0,10]² at z=0, normal +Z.
    vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
    triVerts: new Uint32Array([0, 1, 2, 0, 2, 3]),
    numProp: 3,
    numTri: 2,
  };

  it('is deterministic for a given seed and differs across seeds', () => {
    const a = sampleMeshSurface(quad, { count: 20, seed: 7 });
    const b = sampleMeshSurface(quad, { count: 20, seed: 7 });
    const c = sampleMeshSurface(quad, { count: 20, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(20);
    for (const s of a) {
      expect(s.p[0]).toBeGreaterThanOrEqual(0);
      expect(s.p[0]).toBeLessThanOrEqual(10);
      expect(s.p[2]).toBeCloseTo(0, 6);
      expect(s.n[2]).toBeCloseTo(1, 6);
    }
  });

  it('honors minSpacing', () => {
    const s = sampleMeshSurface(quad, { count: 200, seed: 1, minSpacing: 3 });
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const dx = s[i].p[0] - s[j].p[0], dy = s[i].p[1] - s[j].p[1];
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(3 - 1e-9);
      }
    }
    expect(s.length).toBeGreaterThan(3); // still placed a reasonable number
  });

  it('honors the where predicate', () => {
    const s = sampleMeshSurface(quad, { count: 30, seed: 2, where: (p) => p[0] < 5 });
    expect(s.length).toBeGreaterThan(0);
    for (const smp of s) expect(smp.p[0]).toBeLessThan(5);
  });

  it('instanceMatrix aligns +Z to the normal and translates to p + n·offset', () => {
    const m = instanceMatrix({ p: [1, 2, 3], n: [1, 0, 0] }, 1, 0, true, 0.5);
    // Local +Z (0,0,1) → world normal (1,0,0): column 2 of the rotation.
    expect(m[8]).toBeCloseTo(1, 6);  // col2.x
    expect(m[9]).toBeCloseTo(0, 6);
    expect(m[10]).toBeCloseTo(0, 6);
    // Translation = p + n·offset = (1.5, 2, 3).
    expect(m[12]).toBeCloseTo(1.5, 9);
    expect(m[13]).toBeCloseTo(2, 9);
    expect(m[14]).toBeCloseTo(3, 9);
  });
});
