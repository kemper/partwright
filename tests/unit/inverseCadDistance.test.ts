// Sampling + k-d tree + distance-metric coverage.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs scripts
import { samplePoints, buildKdTree, makeRng } from '../../scripts/inverse-cad/sampleMesh.mjs';
// @ts-expect-error — .mjs scripts
import { meshDistance } from '../../scripts/inverse-cad/distance.mjs';

function cube(offset: [number, number, number] = [0, 0, 0]): Float32Array {
  const [ox, oy, oz] = offset;
  const v = (i: number, j: number, k: number) => [ox + i, oy + j, oz + k] as const;
  const faces: readonly (readonly (readonly [number, number, number])[])[] = [
    [v(0,0,0), v(1,0,0), v(1,1,0), v(0,1,0)],
    [v(0,0,1), v(0,1,1), v(1,1,1), v(1,0,1)],
    [v(0,0,0), v(0,1,0), v(0,1,1), v(0,0,1)],
    [v(1,0,0), v(1,0,1), v(1,1,1), v(1,1,0)],
    [v(0,0,0), v(0,0,1), v(1,0,1), v(1,0,0)],
    [v(0,1,0), v(1,1,0), v(1,1,1), v(0,1,1)],
  ];
  const tris: number[] = [];
  for (const quad of faces) {
    const [a, b, c, d] = quad;
    tris.push(...a, ...b, ...c);
    tris.push(...a, ...c, ...d);
  }
  return Float32Array.from(tris);
}

describe('inverse-cad/sampleMesh.samplePoints', () => {
  it('produces the requested number of points', () => {
    const pts = samplePoints({ triangles: cube() }, 1234, { seed: 42 });
    expect(pts.length).toBe(1234 * 3);
  });

  it('samples lie on the cube surface (each coord is on min/max face or interior)', () => {
    const pts = samplePoints({ triangles: cube() }, 200, { seed: 7 });
    // Every sample must lie in [0,1]^3 AND at least one coord is 0 or 1 (on face)
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      expect(x).toBeGreaterThanOrEqual(-1e-5);
      expect(x).toBeLessThanOrEqual(1 + 1e-5);
      expect(y).toBeGreaterThanOrEqual(-1e-5);
      expect(y).toBeLessThanOrEqual(1 + 1e-5);
      expect(z).toBeGreaterThanOrEqual(-1e-5);
      expect(z).toBeLessThanOrEqual(1 + 1e-5);
      const onFace =
        Math.abs(x) < 1e-4 || Math.abs(x - 1) < 1e-4 ||
        Math.abs(y) < 1e-4 || Math.abs(y - 1) < 1e-4 ||
        Math.abs(z) < 1e-4 || Math.abs(z - 1) < 1e-4;
      expect(onFace).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = samplePoints({ triangles: cube() }, 100, { seed: 5 });
    const b = samplePoints({ triangles: cube() }, 100, { seed: 5 });
    expect(a).toEqual(b);
  });
});

describe('inverse-cad/sampleMesh.buildKdTree', () => {
  it('nearest agrees with brute force on 500 points', () => {
    const rng = makeRng(9);
    const n = 500;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pts[i] = rng() * 100;
    const kd = buildKdTree(pts);
    const rngQ = makeRng(11);
    for (let q = 0; q < 20; q++) {
      const qx = rngQ() * 100, qy = rngQ() * 100, qz = rngQ() * 100;
      let bruteI = -1, bruteD = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = pts[i * 3] - qx;
        const dy = pts[i * 3 + 1] - qy;
        const dz = pts[i * 3 + 2] - qz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bruteD) { bruteD = d; bruteI = i; }
      }
      const kdRes = kd.nearest(qx, qy, qz);
      expect(kdRes.distSq).toBeCloseTo(bruteD, 5);
      expect(kdRes.index).toBe(bruteI);
    }
  });
});

describe('inverse-cad/distance.meshDistance', () => {
  it('reports near-zero chamfer for identical cubes', () => {
    const c = { triangles: cube() };
    const d = meshDistance(c, c, { samples: 2000, seed: 3 });
    // Not zero because we sample two independent point clouds even on the
    // same surface, but should be small relative to the 1-unit cube.
    expect(d.chamfer).toBeLessThan(0.05);
    expect(d.hausdorff).toBeLessThan(0.5);
  });

  it('reports chamfer close to shift for a translated cube', () => {
    const target = { triangles: cube() };
    const shifted = { triangles: cube([5, 0, 0]) };
    const d = meshDistance(target, shifted, { samples: 2000, seed: 3 });
    // Chamfer between two disjoint unit cubes shifted by 5 along X is
    // dominated by nearest-face distance ≈ 4 (from x=1..5, the gap between them).
    expect(d.chamfer).toBeGreaterThan(3);
    expect(d.chamfer).toBeLessThan(5);
  });

  it('is monotonic in shift magnitude', () => {
    const target = { triangles: cube() };
    const d3 = meshDistance(target, { triangles: cube([3, 0, 0]) }, { samples: 1500, seed: 4 });
    const d6 = meshDistance(target, { triangles: cube([6, 0, 0]) }, { samples: 1500, seed: 4 });
    expect(d6.chamfer).toBeGreaterThan(d3.chamfer);
  });
});
