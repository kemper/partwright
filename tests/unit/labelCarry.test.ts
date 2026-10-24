import { describe, it, expect } from 'vitest';
import { carryRunsByNearest, type RunMesh } from '../../src/geometry/labelCarry';
import { nearestSurfaceTriangleMap } from '../../src/surface/colorTransfer';

// One long thin triangle (a "cap" sliver whose centroid sits far from its
// right end) plus a tiny triangle just past that end.
const SLIVER: RunMesh = {
  vertProperties: new Float32Array([0, 0, 0, 30, 0, 0, 0, 1, 0, /* tiny */ 32, 0, 0, 33, 0, 0, 32, 1, 0]),
  triVerts: new Uint32Array([0, 1, 2, 3, 4, 5]),
  numProp: 3,
  numTri: 2,
  runIndex: new Uint32Array([0, 3, 6]),
  runOriginalID: new Uint32Array([7, 9]),
};

describe('label carry through remeshing (#1093)', () => {
  it('nearest-SURFACE matching beats centroid matching for long thin triangles', () => {
    // A point at x=29 sits on the sliver (centroid x=10) but is 3 units from the
    // tiny triangle's centroid (x≈32.3): by surface it belongs to the sliver.
    const map = nearestSurfaceTriangleMap(
      { vertProperties: SLIVER.vertProperties, triVerts: SLIVER.triVerts, numProp: 3, numTri: 2, numVert: 6 },
      new Float64Array([29, 0.01, 0, 32.4, 0.2, 0]),
    );
    expect([...map]).toEqual([0, 1]);
  });

  it('re-sorts output triangles into runs of the nearest source originalID', () => {
    // Output: three small triangles — two over the sliver, one over the tiny one.
    const out: RunMesh = {
      vertProperties: new Float32Array([
        1, 0, 0, 2, 0, 0, 1, 0.5, 0,
        32.2, 0, 0, 32.8, 0, 0, 32.2, 0.5, 0,
        20, 0, 0, 21, 0, 0, 20, 0.2, 0,
      ]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      numProp: 3,
      numTri: 3,
    };
    const r = carryRunsByNearest([SLIVER], out, 99)!;
    expect([...r.runOriginalID]).toEqual([7, 9]);
    expect([...r.runIndex]).toEqual([0, 6, 9]);
    // Run 7 holds output triangles 0 and 2 (in order); run 9 holds triangle 1.
    expect([...r.triVerts]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
  });

  it('several sources sharing an id form one run; ids keep() rejects fall back', () => {
    const shifted = (dx: number, id: number): RunMesh => ({
      vertProperties: new Float32Array([dx, 0, 0, dx + 1, 0, 0, dx, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2]), numProp: 3, numTri: 1,
      runIndex: new Uint32Array([0, 3]), runOriginalID: new Uint32Array([id]),
    });
    const out: RunMesh = {
      vertProperties: new Float32Array([0.2, 0.2, 0, 0.4, 0.2, 0, 0.2, 0.4, 0, 50.2, 0.2, 0, 50.4, 0.2, 0, 50.2, 0.4, 0, 100.2, 0.2, 0, 100.4, 0.2, 0, 100.2, 0.4, 0]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), numProp: 3, numTri: 3,
    };
    const r = carryRunsByNearest([shifted(0, 4), shifted(50, 8), shifted(100, 4)], out, 99, id => id === 4)!;
    expect([...r.runOriginalID]).toEqual([4, 99]);
    expect([...r.runIndex]).toEqual([0, 6, 9]);
    expect([...r.triVerts]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
    expect(carryRunsByNearest([shifted(0, 8)], out, 99, id => id === 4)).toBeNull();
  });

  it('nearest-surface map agrees with brute force on a random triangle soup', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const nt = 400;
    const vp = new Float32Array(nt * 9);
    for (let t = 0; t < nt; t++) {
      const c = [rnd() * 40, rnd() * 40, rnd() * 40];
      for (let k = 0; k < 9; k++) vp[t * 9 + k] = c[k % 3] + rnd() * (t % 10 === 0 ? 20 : 2);
    }
    const mesh = { vertProperties: vp, triVerts: Uint32Array.from({ length: nt * 3 }, (_, i) => i), numProp: 3, numTri: nt, numVert: nt * 3 };
    const q = Float64Array.from({ length: 300 }, () => rnd() * 60 - 10);
    const map = nearestSurfaceTriangleMap(mesh, q);
    // Brute force: densely sampled distance to every triangle (sampling error
    // stays under ~0.6 on the largest triangles, hence the tolerance).
    const dist = (t: number, i: number) => {
      const p = [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]];
      let best = Infinity;
      const N = 24;
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N - a; b++) {
        const u = a / N, v = b / N, w = 1 - u - v;
        let s = 0;
        for (let k = 0; k < 3; k++) { const x = vp[t * 9 + k] * w + vp[t * 9 + 3 + k] * u + vp[t * 9 + 6 + k] * v - p[k]; s += x * x; }
        best = Math.min(best, s);
      }
      return Math.sqrt(best);
    };
    for (let i = 0; i < 100; i++) {
      let bd = Infinity;
      for (let t = 0; t < nt; t++) bd = Math.min(bd, dist(t, i));
      expect(dist(map[i], i)).toBeLessThanOrEqual(bd + 1);
    }
  });

  it('returns null when no source carries provenance', () => {
    const plain: RunMesh = { ...SLIVER, runIndex: undefined, runOriginalID: undefined };
    expect(carryRunsByNearest([plain], SLIVER, 1)).toBeNull();
  });
});
