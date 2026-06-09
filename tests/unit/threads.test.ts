// Unit tests for the pure-logic parts of the threads namespace — the metric
// table, profile math, and the hand-built helix mesh topology. The Manifold
// builders that need the manifold-3d WASM kernel are exercised in the e2e tier
// (tests/gears-threads.spec.ts).
//
// The mesh edge-consistency check below is the key guard: it verifies the
// swept helix is watertight AND consistently oriented without booting WASM —
// exactly the property whose violation (mis-wound caps) made the first draft
// non-manifold.

import { describe, it, expect } from 'vitest';
import { __testables__ } from '../../src/geometry/threads';

const { normalizeSize, resolveThread, threadDepth, threadProfile, buildHelixMesh, METRIC_COARSE } = __testables__;

describe('threads metric table', () => {
  it('covers common sizes and is frozen', () => {
    expect(METRIC_COARSE.M8.nominal).toBe(8);
    expect(METRIC_COARSE.M8.pitch).toBe(1.25);
    expect(Object.isFrozen(METRIC_COARSE)).toBe(true);
  });

  it('normalizes "M2.5" → "M2_5" and rejects unknown sizes', () => {
    expect(normalizeSize('M2.5')).toBe('M2_5');
    expect(normalizeSize('m8')).toBe('M8');
    expect(() => normalizeSize('M7')).toThrow();
    expect(() => normalizeSize(8)).toThrow();
  });
});

describe('threads resolveThread', () => {
  it('resolves a metric size to nominal diameter + coarse pitch', () => {
    expect(resolveThread({ size: 'M6' })).toEqual({ major: 6, pitch: 1.0 });
  });
  it('lets an explicit pitch override the coarse default', () => {
    expect(resolveThread({ size: 'M8', pitch: 1.0 })).toEqual({ major: 8, pitch: 1.0 });
  });
  it('accepts an explicit diameter + pitch', () => {
    expect(resolveThread({ diameter: 9, pitch: 1.5 })).toEqual({ major: 9, pitch: 1.5 });
  });
  it('throws without a size or diameter', () => {
    expect(() => resolveThread({})).toThrow();
  });
});

describe('threads threadDepth & profile', () => {
  it('thread depth is 5/8 · (√3/2 · pitch)', () => {
    expect(threadDepth(1.25)).toBeCloseTo((5 / 8) * (Math.sqrt(3) / 2) * 1.25, 6);
  });

  it('external profile has 6 points spanning crest..buried within one pitch', () => {
    const pitch = 1.25;
    const crestR = 4, rootR = 3.3, buriedR = 3.0;
    const prof = threadProfile(crestR, rootR, buriedR, pitch);
    expect(prof.length).toBe(6);
    // Crest is the largest radius reached; buried is the smallest.
    expect(Math.max(...prof.map((p) => p.r))).toBe(crestR);
    expect(Math.min(...prof.map((p) => p.r))).toBe(buriedR);
    // The tooth must be narrower than the pitch so adjacent coils never touch.
    const span = Math.max(...prof.map((p) => p.z)) - Math.min(...prof.map((p) => p.z));
    expect(span).toBeLessThan(pitch);
  });

  it('internal profile (crest < root) mirrors radially', () => {
    const prof = threadProfile(3.0, 4.0, 4.3, 1.25);
    expect(Math.min(...prof.map((p) => p.r))).toBe(3.0); // crest points inward
    expect(Math.max(...prof.map((p) => p.r))).toBe(4.3); // buried in the body
  });
});

describe('threads buildHelixMesh topology', () => {
  const profile = threadProfile(4, 3.3, 3.0, 1.25);
  const mesh = buildHelixMesh(profile, 1.25, 0, 2 * Math.PI * 2, 24, 'right');

  it('emits (rings+1)·m vertices', () => {
    const m = profile.length;
    const rings = Math.ceil(2 * 24); // 2 turns × segmentsPerTurn
    expect(mesh.vertProperties.length / 3).toBe((rings + 1) * m);
  });

  it('is watertight and consistently oriented (closed orientable manifold)', () => {
    const tv = mesh.triVerts;
    const undirected = new Map<string, number>();
    const directed = new Map<string, number>();
    for (let t = 0; t < tv.length; t += 3) {
      const tri = [tv[t], tv[t + 1], tv[t + 2]];
      for (let e = 0; e < 3; e++) {
        const x = tri[e], y = tri[(e + 1) % 3];
        directed.set(`${x}>${y}`, (directed.get(`${x}>${y}`) ?? 0) + 1);
        const key = x < y ? `${x}-${y}` : `${y}-${x}`;
        undirected.set(key, (undirected.get(key) ?? 0) + 1);
      }
    }
    // Watertight: every undirected edge bounds exactly two triangles.
    for (const [, n] of undirected) expect(n).toBe(2);
    // Orientable: every directed edge is traversed exactly once.
    for (const [, n] of directed) expect(n).toBe(1);
  });

  it("left-handed winding mirrors the helix's z-advance direction", () => {
    const right = buildHelixMesh(profile, 1.25, 0, 2 * Math.PI, 12, 'right');
    const left = buildHelixMesh(profile, 1.25, 0, 2 * Math.PI, 12, 'left');
    // Same vertex count; the y-coordinate of the first off-origin ring flips sign.
    expect(right.vertProperties.length).toBe(left.vertProperties.length);
    const m = profile.length;
    // First vertex of ring 1 (index m): x same, y opposite between handedness.
    expect(right.vertProperties[m * 3 + 1]).toBeCloseTo(-left.vertProperties[m * 3 + 1], 6);
  });
});
