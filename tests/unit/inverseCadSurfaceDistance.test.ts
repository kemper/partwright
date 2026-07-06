// Exact point-to-triangle-surface distance coverage: BVH build, closest
// point, ray-parity inside test, and the aggregate signedMeshDistance API.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs scripts
import { buildTriBvh, closestPointOnMesh, isInside, signedMeshDistance } from '../../scripts/inverse-cad/surfaceDistance.mjs';

function cube(offset: [number, number, number] = [0, 0, 0]): Float32Array {
  const [ox, oy, oz] = offset;
  const v = (i: number, j: number, k: number) => [ox + i, oy + j, oz + k] as const;
  const faces: readonly (readonly (readonly [number, number, number])[])[] = [
    [v(0,0,0), v(1,0,0), v(1,1,0), v(0,1,0)], // -Z
    [v(0,0,1), v(0,1,1), v(1,1,1), v(1,0,1)], // +Z
    [v(0,0,0), v(0,1,0), v(0,1,1), v(0,0,1)], // -X
    [v(1,0,0), v(1,0,1), v(1,1,1), v(1,1,0)], // +X
    [v(0,0,0), v(0,0,1), v(1,0,1), v(1,0,0)], // -Y
    [v(0,1,0), v(1,1,0), v(1,1,1), v(0,1,1)], // +Y
  ];
  const tris: number[] = [];
  for (const quad of faces) {
    const [a, b, c, d] = quad;
    tris.push(...a, ...b, ...c);
    tris.push(...a, ...c, ...d);
  }
  return Float32Array.from(tris);
}

// A single triangle in the XY plane: (0,0,0), (1,0,0), (0,1,0).
function singleTriangle(): Float32Array {
  return Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

describe('inverse-cad/surfaceDistance.closestPointOnMesh — single triangle', () => {
  const bvh = buildTriBvh({ triangles: singleTriangle() });

  it('point directly above the face interior', () => {
    const r = closestPointOnMesh(bvh, 0.25, 0.25, 2);
    expect(r.dist).toBeCloseTo(2, 6);
    expect(r.px).toBeCloseTo(0.25, 6);
    expect(r.py).toBeCloseTo(0.25, 6);
    expect(r.pz).toBeCloseTo(0, 6);
  });

  it('point off an edge (hypotenuse, x+y=1)', () => {
    // Query point offset perpendicular from the hypotenuse edge x+y=1 (z=0).
    // Perpendicular direction in-plane is (1,1)/sqrt(2); offset by d.
    const d = 3;
    const off = d / Math.sqrt(2);
    const qx = 0.5 + off, qy = 0.5 + off, qz = 0;
    const r = closestPointOnMesh(bvh, qx, qy, qz);
    expect(r.dist).toBeCloseTo(d, 5);
    expect(r.px).toBeCloseTo(0.5, 5);
    expect(r.py).toBeCloseTo(0.5, 5);
  });

  it('point off a vertex (beyond corner (1,0,0))', () => {
    const r = closestPointOnMesh(bvh, 2, -1, 0);
    const expected = Math.hypot(2 - 1, -1 - 0, 0);
    expect(r.dist).toBeCloseTo(expected, 6);
    expect(r.px).toBeCloseTo(1, 6);
    expect(r.py).toBeCloseTo(0, 6);
    expect(r.pz).toBeCloseTo(0, 6);
  });
});

describe('inverse-cad/surfaceDistance — unit cube (12 tris)', () => {
  const mesh = { triangles: cube() };
  const bvh = buildTriBvh(mesh);

  it('point inside the cube is classified inside', () => {
    expect(isInside(bvh, mesh, 0.5, 0.5, 0.5)).toBe(true);
  });

  it('point outside the cube is classified outside', () => {
    expect(isInside(bvh, mesh, 5, 5, 5)).toBe(false);
    expect(isInside(bvh, mesh, -2, 0.5, 0.5)).toBe(false);
  });

  it('distance to nearest face is exact', () => {
    // (0.5, 0.5, 3) is 2 units above the top face (z=1).
    const r = closestPointOnMesh(bvh, 0.5, 0.5, 3);
    expect(r.dist).toBeCloseTo(2, 6);
    expect(r.pz).toBeCloseTo(1, 6);
  });

  it('distance to nearest edge is exact', () => {
    // (1.5, 1.5, 0.5) is closest to edge (1,1,z), z in [0,1]. Distance
    // is sqrt(0.5^2+0.5^2) = sqrt(0.5).
    const r = closestPointOnMesh(bvh, 1.5, 1.5, 0.5);
    expect(r.dist).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(r.px).toBeCloseTo(1, 6);
    expect(r.py).toBeCloseTo(1, 6);
    expect(r.pz).toBeCloseTo(0.5, 6);
  });

  it('distance to nearest corner is exact', () => {
    // (2, 2, 2) is closest to corner (1,1,1): distance sqrt(3).
    const r = closestPointOnMesh(bvh, 2, 2, 2);
    expect(r.dist).toBeCloseTo(Math.sqrt(3), 6);
    expect(r.px).toBeCloseTo(1, 6);
    expect(r.py).toBeCloseTo(1, 6);
    expect(r.pz).toBeCloseTo(1, 6);
  });
});

describe('inverse-cad/surfaceDistance.signedMeshDistance', () => {
  it('self-distance is ~0 (chamfer and hausdorff both near zero)', () => {
    const mesh = { triangles: cube() };
    const d = signedMeshDistance(mesh, mesh, { samples: 2000, seed: 3 });
    expect(d.method).toBe('point-to-triangle-bvh');
    expect(d.chamfer).toBeLessThan(1e-6);
    expect(d.hausdorff).toBeLessThan(1e-6);
  });

  it('known offset: cube vs the same cube translated 0.5 in X', () => {
    const target = { triangles: cube() };
    const shifted = { triangles: cube([0.5, 0, 0]) };
    const d = signedMeshDistance(target, shifted, { samples: 4000, seed: 5 });
    expect(d.hausdorff).toBeCloseTo(0.5, 1);
    // Most of the candidate's skin overlaps the target's (0 distance), so
    // the mean-based chamfer is well below the 0.5 hausdorff — it's a
    // stable value around 0.19, not close to the 0.5 shift itself.
    expect(d.chamfer).toBeGreaterThan(0.15);
    expect(d.chamfer).toBeLessThan(0.3);
    // The shifted (candidate) cube pokes out past x=1 on the target: that's
    // excess material. It's missing material for x in [0, 0.5) that the
    // target had but the shifted candidate no longer covers there.
    expect(d.candToTarget.excessArea_mm2).toBeGreaterThan(0);
    expect(d.candToTarget.missingArea_mm2).toBeGreaterThan(0);
    expect(d.targetToCand.excessArea_mm2).toBeGreaterThan(0);
    expect(d.targetToCand.missingArea_mm2).toBeGreaterThan(0);
  });

  it('ray-parity is robust for points aligned with cube grid vertices (grazing rays)', () => {
    const mesh = { triangles: cube() };
    const bvh = buildTriBvh(mesh);
    // Query points that lie exactly on the +X-axis-aligned lines through
    // cube vertices/edges — a naive +X ray cast from these would graze
    // vertices/edges of multiple triangles.
    expect(isInside(bvh, mesh, -1, 0, 0)).toBe(false);
    expect(isInside(bvh, mesh, -1, 1, 0)).toBe(false);
    expect(isInside(bvh, mesh, -1, 1, 1)).toBe(false);
    expect(isInside(bvh, mesh, -1, 0, 1)).toBe(false);
    // Off-grid control (not a grazing case): unambiguously outside.
    expect(isInside(bvh, mesh, -1, 0.5, 0.5)).toBe(false);
  });
});
