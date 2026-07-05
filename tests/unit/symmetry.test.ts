import { describe, it, expect } from 'vitest';
import {
  detectSymmetryPlane,
  mirrorIslandPairs,
  mirrorTriangleSet,
  reflectPoint,
  reflectVector,
  type SymmetryPlane,
} from '../../src/color/symmetry';
import { meshIslands } from '../../src/color/meshIslands';
import type { MeshData } from '../../src/geometry/types';

/** Build a MeshData from a list of triangles, each defined by its three
 *  world-space vertices (triangle soup — see meshIslands.test.ts for why). */
function meshFromTriangles(triangles: [number, number, number][][]): MeshData {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  triangles.forEach((tri, t) => {
    for (const [x, y, z] of tri) vertProperties.push(x, y, z);
    triVerts.push(t * 3, t * 3 + 1, t * 3 + 2);
  });
  return {
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
    numProp: 3,
    numVert: triangles.length * 3,
    numTri: triangles.length,
  } as MeshData;
}

/** A 24-triangle cube (a 4-triangle center-fan per face — O,A,B / O,B,C /
 *  O,C,D / O,D,A around each face's midpoint), centered at `center` with
 *  half-extent `h`. Unlike a naive 2-triangle diagonal split per face (which
 *  is only symmetric under 180° rotation, NOT under a single axis mirror),
 *  the center-fan is exactly symmetric under reflection across either of a
 *  face's two free axes AND under the opposing-face swap — the property
 *  these tests need to get a true residual-0 mirror match. Face order is
 *  fixed and documented so tests can index specific faces (4 triangles
 *  each): [0-3]=-z [4-7]=+z [8-11]=-y [12-15]=+y [16-19]=-x [20-23]=+x. */
function cubeTriangles(center: [number, number, number], h: number): [number, number, number][][] {
  const base = center;
  type AxisIdx = 0 | 1 | 2;
  const faces: Array<{ fixed: AxisIdx; sign: -1 | 1; u: AxisIdx; v: AxisIdx }> = [
    { fixed: 2, sign: -1, u: 0, v: 1 }, // -z
    { fixed: 2, sign: 1, u: 0, v: 1 },  // +z
    { fixed: 1, sign: -1, u: 0, v: 2 }, // -y
    { fixed: 1, sign: 1, u: 0, v: 2 },  // +y
    { fixed: 0, sign: -1, u: 1, v: 2 }, // -x
    { fixed: 0, sign: 1, u: 1, v: 2 },  // +x
  ];
  const tris: [number, number, number][][] = [];
  for (const f of faces) {
    const mk = (uu: number, vv: number): [number, number, number] => {
      const p: [number, number, number] = [base[0], base[1], base[2]];
      p[f.fixed] = base[f.fixed] + f.sign * h;
      p[f.u] = base[f.u] + uu * h;
      p[f.v] = base[f.v] + vv * h;
      return p;
    };
    const o = mk(0, 0), a = mk(-1, -1), b = mk(1, -1), c = mk(1, 1), d = mk(-1, 1);
    tris.push([o, a, b], [o, b, c], [o, c, d], [o, d, a]);
  }
  return tris;
}

/** A 4-triangle tetrahedron — a different shape/triangleCount than the cube,
 *  for the "no false symmetry" test. */
function tetrahedronTriangles(center: [number, number, number], s: number): [number, number, number][][] {
  const [cx, cy, cz] = center;
  const p0: [number, number, number] = [cx, cy + s, cz];
  const p1: [number, number, number] = [cx - s, cy - s, cz - s];
  const p2: [number, number, number] = [cx + s, cy - s, cz - s];
  const p3: [number, number, number] = [cx, cy - s, cz + s];
  return [
    [p0, p1, p2],
    [p0, p2, p3],
    [p0, p3, p1],
    [p1, p3, p2],
  ];
}

describe('detectSymmetryPlane', () => {
  it('finds the x-axis mirror plane between two identical translated cubes', () => {
    const mesh = meshFromTriangles([
      ...cubeTriangles([-5, 0, 0], 2),
      ...cubeTriangles([5, 0, 0], 2),
    ]);
    const plane = detectSymmetryPlane(mesh);
    expect(plane).not.toBeNull();
    expect(plane!.axis).toBe('x');
    expect(plane!.score).toBeGreaterThan(0.9);
  });

  it('pairs the two cube islands as mirror siblings', () => {
    const mesh = meshFromTriangles([
      ...cubeTriangles([-5, 0, 0], 2),
      ...cubeTriangles([5, 0, 0], 2),
    ]);
    const plane = detectSymmetryPlane(mesh)!;
    const pairs = mirrorIslandPairs(mesh, plane);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toBe(1);
    expect(pairs[1]).toBe(0);
  });

  it('finds a plane for a single centered cube and maps its island to itself', () => {
    const mesh = meshFromTriangles(cubeTriangles([0, 0, 0], 2));
    const plane = detectSymmetryPlane(mesh);
    expect(plane).not.toBeNull();
    expect(plane!.score).toBeGreaterThan(0.9);

    const pairs = mirrorIslandPairs(mesh, plane!);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toBe(0);
  });

  it('does not produce a false mirror pair for an asymmetric mesh', () => {
    // One cube plus a differently-shaped, differently-sized blob elsewhere —
    // triangleCounts differ (12 vs 4), so even if a plane is detected, the
    // two islands must never be paired with each other.
    const mesh = meshFromTriangles([
      ...cubeTriangles([5, 0, 0], 2),
      ...tetrahedronTriangles([0, 9, 4], 3),
    ]);
    const { islands } = meshIslands(mesh);
    expect(islands).toHaveLength(2);
    const cubeIdx = islands[0].triangleCount === 12 ? 0 : 1;
    const blobIdx = cubeIdx === 0 ? 1 : 0;

    const plane = detectSymmetryPlane(mesh);
    if (plane === null) {
      expect(plane).toBeNull();
    } else {
      const pairs = mirrorIslandPairs(mesh, plane);
      expect(pairs[cubeIdx]).not.toBe(blobIdx);
      expect(pairs[blobIdx]).not.toBe(cubeIdx);
    }
  });
});

describe('mirrorTriangleSet', () => {
  it('mirrors the +x face of the left cube onto the -x face of the right cube', () => {
    // Left cube occupies triangles [0..23], right cube [24..47] (see
    // cubeTriangles' documented face order). Left's +x face is [20..23];
    // its mirror across x=0 is right's -x face (local indices 16..19).
    const mesh = meshFromTriangles([
      ...cubeTriangles([-5, 0, 0], 2),
      ...cubeTriangles([5, 0, 0], 2),
    ]);
    const plane = detectSymmetryPlane(mesh)!;
    expect(plane.axis).toBe('x');

    const { triIslands } = meshIslands(mesh);
    const rightIslandId = triIslands[24];
    const leftIslandId = triIslands[0];
    expect(rightIslandId).not.toBe(leftIslandId);

    const result = mirrorTriangleSet(new Set([20, 21, 22, 23]), mesh, plane);
    expect(result.snapped).toBe(4);
    expect(result.rejected).toBe(0);
    expect(result.triangles.size).toBe(4);
    for (const t of result.triangles) expect(triIslands[t]).toBe(rightIslandId);
    expect(result.meanSnapError).toBeLessThan(1e-4);
  });
});

describe('reflectPoint / reflectVector', () => {
  const plane: SymmetryPlane = { axis: 'x', point: [1, 2, 3], normal: [1, 0, 0], residual: 0, score: 1 };

  it('reflecting a point twice returns the original point', () => {
    const p: [number, number, number] = [5, 7, -2];
    const once = reflectPoint(p, plane);
    const twice = reflectPoint(once, plane);
    expect(Math.abs(twice[0] - p[0])).toBeLessThan(1e-12);
    expect(Math.abs(twice[1] - p[1])).toBeLessThan(1e-12);
    expect(Math.abs(twice[2] - p[2])).toBeLessThan(1e-12);
  });

  it('reflecting a vector twice returns the original vector', () => {
    const v: [number, number, number] = [3, -4, 8];
    const once = reflectVector(v, plane);
    const twice = reflectVector(once, plane);
    expect(Math.abs(twice[0] - v[0])).toBeLessThan(1e-12);
    expect(Math.abs(twice[1] - v[1])).toBeLessThan(1e-12);
    expect(Math.abs(twice[2] - v[2])).toBeLessThan(1e-12);
  });

  it('reflects a point across an x-axis plane correctly', () => {
    const p: [number, number, number] = [4, 2, 3];
    const reflected = reflectPoint(p, plane); // plane.point.x = 1 → distance 3 → reflected x = 1 - 3 = -2
    expect(reflected).toEqual([-2, 2, 3]);
  });
});
