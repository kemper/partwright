// Unit tests for src/geometry/sdfRefine.ts — the localized refine-and-project
// pass behind `api.sdf.build({ detail })`. Pure logic: subdivision conformity
// (watertightness), surface projection accuracy, region scoping, and caps.

import { describe, it, expect } from 'vitest';
import { refineMeshNearRegions, sphereIntersectsBox } from '../../src/geometry/sdfRefine';

/** Unit octahedron — all 6 vertices lie exactly on the unit sphere. */
function octahedron(): { positions: Float32Array; triVerts: Uint32Array } {
  const positions = new Float32Array([
    1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
    2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
  ]);
  return { positions, triVerts };
}

const unitSphereSdf = (x: number, y: number, z: number): number =>
  Math.sqrt(x * x + y * y + z * z) - 1;

/** Every undirected edge of a closed 2-manifold mesh borders exactly 2 tris. */
function isWatertight(triVerts: Uint32Array): boolean {
  const count = new Map<string, number>();
  for (let t = 0; t < triVerts.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triVerts[t + e], b = triVerts[t + (e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (const n of count.values()) {
    if (n !== 2) return false;
  }
  return true;
}

describe('refineMeshNearRegions', () => {
  it('subdivides inside the region and projects new vertices onto the surface', () => {
    const { positions, triVerts } = octahedron();
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [0, 0, 0], radius: 2, edgeLength: 0.25 },
    ]);
    expect(out.rounds).toBeGreaterThan(0);
    expect(out.triVerts.length).toBeGreaterThan(triVerts.length);
    // Every vertex (old + projected midpoints) sits on the unit sphere.
    for (let v = 0; v < out.positions.length; v += 3) {
      const r = Math.hypot(out.positions[v], out.positions[v + 1], out.positions[v + 2]);
      expect(Math.abs(r - 1)).toBeLessThan(0.02);
    }
    // Edges inside the region reached the target.
    let maxEdge = 0;
    for (let t = 0; t < out.triVerts.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = out.triVerts[t + e], b = out.triVerts[t + (e + 1) % 3];
        maxEdge = Math.max(maxEdge, Math.hypot(
          out.positions[a * 3] - out.positions[b * 3],
          out.positions[a * 3 + 1] - out.positions[b * 3 + 1],
          out.positions[a * 3 + 2] - out.positions[b * 3 + 2],
        ));
      }
    }
    expect(maxEdge).toBeLessThanOrEqual(0.25 + 1e-6);
  });

  it('keeps the mesh watertight when refining only part of it', () => {
    const { positions, triVerts } = octahedron();
    // Region covers only the +X pole — boundary triangles get partial splits.
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [1, 0, 0], radius: 0.6, edgeLength: 0.3 },
    ]);
    expect(out.rounds).toBeGreaterThan(0);
    expect(isWatertight(out.triVerts)).toBe(true);
  });

  it('leaves the mesh unchanged when no region touches it', () => {
    const { positions, triVerts } = octahedron();
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [10, 0, 0], radius: 0.5, edgeLength: 0.1 },
    ]);
    expect(out.rounds).toBe(0);
    expect(out.triVerts).toBe(triVerts);
  });

  it('leaves the mesh unchanged when edges are already fine enough', () => {
    const { positions, triVerts } = octahedron();
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [0, 0, 0], radius: 2, edgeLength: 5 },
    ]);
    expect(out.rounds).toBe(0);
  });

  it('respects the maxTriangles cap', () => {
    const { positions, triVerts } = octahedron();
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [0, 0, 0], radius: 2, edgeLength: 0.01 },
    ], { maxTriangles: 100 });
    expect(out.triVerts.length / 3).toBeLessThanOrEqual(100);
  });

  it('respects maxRounds', () => {
    const { positions, triVerts } = octahedron();
    const out = refineMeshNearRegions(positions, triVerts, unitSphereSdf, [
      { center: [0, 0, 0], radius: 2, edgeLength: 0.001 },
    ], { maxRounds: 2 });
    expect(out.rounds).toBe(2);
  });
});

describe('sphereIntersectsBox', () => {
  it('detects overlap, containment, and separation', () => {
    expect(sphereIntersectsBox([0, 0, 0], 1, [-2, -2, -2], [2, 2, 2])).toBe(true);   // inside
    expect(sphereIntersectsBox([3, 0, 0], 1.5, [-2, -2, -2], [2, 2, 2])).toBe(true); // overlaps face
    expect(sphereIntersectsBox([5, 5, 5], 1, [-2, -2, -2], [2, 2, 2])).toBe(false);  // separate
  });
});
