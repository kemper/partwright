import { describe, it, expect } from 'vitest';
import { meshIslands, trianglesInIsland, islandAtPoint, clearMeshIslandsCache } from '../../src/color/meshIslands';
import type { MeshData } from '../../src/geometry/types';

/** Build a MeshData from a list of triangles, each defined by its three world-
 *  space vertices. Vertices are stored per-triangle (triangle soup) — the
 *  adjacency layer welds them by exact position, so two triangles sharing a
 *  vertex coordinate are recognized as adjacent. */
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

describe('meshIslands', () => {
  it('returns one island for a single connected component', () => {
    // Two triangles sharing an edge (vertices at the same position).
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    ]);
    const { triIslands, islands } = meshIslands(mesh);
    expect(islands).toHaveLength(1);
    expect(islands[0].triangleCount).toBe(2);
    expect(triIslands[0]).toBe(0);
    expect(triIslands[1]).toBe(0);
  });

  it('separates two disconnected triangle groups into two islands', () => {
    // Triangle A at origin, triangle B at z=100 — no shared vertices.
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 100], [1, 0, 100], [0, 1, 100]],
    ]);
    const { triIslands, islands } = meshIslands(mesh);
    expect(islands).toHaveLength(2);
    expect(triIslands[0]).not.toBe(triIslands[1]);
    expect(islands[0].triangleCount).toBe(1);
    expect(islands[1].triangleCount).toBe(1);
  });

  it('computes per-island bbox and center from the triangle vertices', () => {
    const mesh = meshFromTriangles([
      [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      [[100, 100, 100], [110, 100, 100], [100, 110, 100]],
    ]);
    const { islands } = meshIslands(mesh);
    expect(islands[0].bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    expect(islands[0].center).toEqual([5, 5, 0]);
    expect(islands[1].bbox).toEqual({ min: [100, 100, 100], max: [110, 110, 100] });
    expect(islands[1].center).toEqual([105, 105, 100]);
  });

  it('handles 25 disjoint triangles (multi-part STL kit scale)', () => {
    const tris: [number, number, number][][] = [];
    for (let i = 0; i < 25; i++) {
      const z = i * 50;
      tris.push([[0, 0, z], [1, 0, z], [0, 1, z]]);
    }
    const mesh = meshFromTriangles(tris);
    const { islands } = meshIslands(mesh);
    expect(islands).toHaveLength(25);
    for (let i = 0; i < 25; i++) expect(islands[i].triangleCount).toBe(1);
  });

  it('returns empty result for an empty mesh', () => {
    const mesh: MeshData = {
      vertProperties: new Float32Array(),
      triVerts: new Uint32Array(),
      numProp: 3,
      numVert: 0,
      numTri: 0,
    } as MeshData;
    const { triIslands, islands } = meshIslands(mesh);
    expect(triIslands.length).toBe(0);
    expect(islands).toEqual([]);
  });

  it('memoizes results on the same mesh reference (WeakMap cache)', () => {
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    ]);
    const a = meshIslands(mesh);
    const b = meshIslands(mesh);
    expect(b).toBe(a);
    clearMeshIslandsCache(mesh);
    const c = meshIslands(mesh);
    expect(c).not.toBe(a);
  });
});

describe('trianglesInIsland', () => {
  it('returns the triangle indices belonging to one island', () => {
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0, 0, 100], [1, 0, 100], [0, 1, 100]],
    ]);
    const { triIslands } = meshIslands(mesh);
    const island0Tris = trianglesInIsland(triIslands, triIslands[0]);
    expect(island0Tris.size).toBe(2);
    expect([...island0Tris].sort()).toEqual([0, 1]);
    const island2Tris = trianglesInIsland(triIslands, triIslands[2]);
    expect(island2Tris.size).toBe(1);
    expect([...island2Tris]).toEqual([2]);
  });
});

describe('islandAtPoint', () => {
  it('returns the island index containing the triangle closest to a point', () => {
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],          // island 0 near origin
      [[0, 0, 100], [1, 0, 100], [0, 1, 100]],    // island 1 at z=100
    ]);
    expect(islandAtPoint(mesh, [0.3, 0.3, 0])).toBe(0);
    expect(islandAtPoint(mesh, [0.3, 0.3, 100])).toBe(1);
    // A midway point still picks ONE island deterministically (whichever's
    // centroid is closer); both are equidistant at z=50, so just check valid.
    const mid = islandAtPoint(mesh, [0.3, 0.3, 50]);
    expect([0, 1]).toContain(mid);
  });

  it('returns -1 for an empty mesh', () => {
    const mesh: MeshData = {
      vertProperties: new Float32Array(),
      triVerts: new Uint32Array(),
      numProp: 3,
      numVert: 0,
      numTri: 0,
    } as MeshData;
    expect(islandAtPoint(mesh, [0, 0, 0])).toBe(-1);
  });
});
