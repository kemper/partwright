import { describe, it, expect } from 'vitest';
import { partitionTriangles, referencePerpendicular } from '../../src/color/partition';
import type { MeshData } from '../../src/geometry/types';

/** Triangle-soup MeshData builder (same pattern as meshIslands.test.ts). */
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

/** A tiny triangle centered near `c` (small enough that centroid ≈ c). */
function triAt(c: [number, number, number]): [number, number, number][] {
  const e = 0.01;
  return [
    [c[0] - e, c[1] - e, c[2]],
    [c[0] + e, c[1] - e, c[2]],
    [c[0], c[1] + e, c[2]],
  ];
}

describe('partitionTriangles — bands', () => {
  it('slices a row of triangles into equal bands along x', () => {
    const centers: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) centers.push([i, 0, 0]);
    const mesh = meshFromTriangles(centers.map(triAt));
    const res = partitionTriangles(mesh, centers.map((_, i) => i), { kind: 'bands', axis: [1, 0, 0], count: 3 });
    if ('error' in res) throw new Error(res.error);
    expect(res.cells).toHaveLength(3);
    expect(res.cells.map(c => c.size)).toEqual([4, 4, 4]);
    // Low band holds the low-x triangles.
    expect([...res.cells[0]].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('works along an arbitrary diagonal axis', () => {
    const centers: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) centers.push([i, i, 0]);
    const mesh = meshFromTriangles(centers.map(triAt));
    const res = partitionTriangles(mesh, centers.map((_, i) => i), { kind: 'bands', axis: [1, 1, 0], count: 2 });
    if ('error' in res) throw new Error(res.error);
    expect([...res.cells[0]].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect([...res.cells[1]].sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  it('errors on zero extent', () => {
    const mesh = meshFromTriangles([triAt([0, 0, 0]), triAt([0, 1, 0])]);
    const res = partitionTriangles(mesh, [0, 1], { kind: 'bands', axis: [1, 0, 0], count: 2 });
    expect('error' in res).toBe(true);
  });

  it('count: 1 fills the whole scope as one cell (even at zero extent)', () => {
    const mesh = meshFromTriangles([triAt([0, 0, 0]), triAt([0, 1, 0])]);
    const res = partitionTriangles(mesh, [0, 1], { kind: 'bands', axis: [1, 0, 0], count: 1 });
    if ('error' in res) throw new Error(res.error);
    expect(res.cells).toHaveLength(1);
    expect(res.cells[0].size).toBe(2);
  });
});

describe('partitionTriangles — wedges', () => {
  it('buckets a circle of triangles into angular sectors', () => {
    // 8 triangles evenly on a unit circle in the XY plane, wedges about +Z.
    const centers: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * 2 * Math.PI) / 8 + 0.05; // offset off exact boundaries
      centers.push([Math.cos(a), Math.sin(a), 0]);
    }
    const mesh = meshFromTriangles(centers.map(triAt));
    const res = partitionTriangles(mesh, centers.map((_, i) => i), {
      kind: 'wedges', axis: [0, 0, 1], center: [0, 0, 0], count: 4,
    });
    if ('error' in res) throw new Error(res.error);
    expect(res.cells).toHaveLength(4);
    // 8 points / 4 wedges = 2 per wedge, every wedge non-empty.
    expect(res.cells.map(c => c.size)).toEqual([2, 2, 2, 2]);
  });

  it('phaseDeg rotates the sector boundaries', () => {
    const centers: [number, number, number][] = [[1, 0.01, 0], [-1, -0.01, 0]];
    const mesh = meshFromTriangles(centers.map(triAt));
    const base = partitionTriangles(mesh, [0, 1], { kind: 'wedges', axis: [0, 0, 1], center: [0, 0, 0], count: 2 });
    const rot = partitionTriangles(mesh, [0, 1], { kind: 'wedges', axis: [0, 0, 1], center: [0, 0, 0], count: 2, phaseDeg: 90 });
    if ('error' in base || 'error' in rot) throw new Error('unexpected');
    // Two opposite points land in different wedges either way, but the
    // assignment flips membership when the boundary rotates through them.
    expect(base.cells[0].size).toBe(1);
    expect(rot.cells[0].size).toBe(1);
    const baseCell0 = [...base.cells[0]][0];
    const rotCell0 = [...rot.cells[0]][0];
    expect(baseCell0).not.toBe(rotCell0);
  });
});

describe('partitionTriangles — rings', () => {
  it('buckets by perpendicular distance from the axis', () => {
    // Triangles at radius 0.5, 1.5, 2.5 from the Z axis — boundaries 1, 2.
    const centers: [number, number, number][] = [
      [0.5, 0, 0], [0, 0.5, 3],   // inner (z offset must not matter)
      [1.5, 0, 0], [0, -1.5, -2],
      [2.5, 0, 0],
    ];
    const mesh = meshFromTriangles(centers.map(triAt));
    const res = partitionTriangles(mesh, [0, 1, 2, 3, 4], {
      kind: 'rings', axis: [0, 0, 1], center: [0, 0, 0], radii: [1, 2],
    });
    if ('error' in res) throw new Error(res.error);
    expect(res.cells).toHaveLength(3);
    expect([...res.cells[0]].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...res.cells[1]].sort((a, b) => a - b)).toEqual([2, 3]);
    expect([...res.cells[2]]).toEqual([4]);
  });

  it('rejects non-increasing radii', () => {
    const mesh = meshFromTriangles([triAt([1, 0, 0])]);
    const res = partitionTriangles(mesh, [0], { kind: 'rings', axis: [0, 0, 1], center: [0, 0, 0], radii: [2, 1] });
    expect('error' in res).toBe(true);
  });
});

describe('referencePerpendicular', () => {
  it('returns a unit vector perpendicular to the axis', () => {
    for (const raw of [[0, 0, 1], [1, 0, 0], [1, 1, 1], [0, -1, 0]] as [number, number, number][]) {
      // Contract: axis is unit length (partitionTriangles normalizes first).
      const len = Math.hypot(raw[0], raw[1], raw[2]);
      const axis: [number, number, number] = [raw[0] / len, raw[1] / len, raw[2] / len];
      const p = referencePerpendicular(axis);
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 9);
      expect(Math.abs(p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2])).toBeLessThan(1e-9);
    }
  });
});
