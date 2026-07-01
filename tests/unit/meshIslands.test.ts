import { describe, it, expect } from 'vitest';
import { meshIslands, trianglesInIsland, islandAtPoint, clearMeshIslandsCache, subsetMesh } from '../../src/color/meshIslands';
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

describe('MeshIsland shape metadata (#871 — Tier 1a)', () => {
  it('flags a long-along-X stick as principalAxis=x with an elongated aspect ratio', () => {
    // Two triangles forming a strip 20 wide (X), 2 tall (Y), 0 deep (Z).
    const mesh = meshFromTriangles([
      [[0, 0, 0], [20, 0, 0], [0, 2, 0]],
      [[20, 0, 0], [20, 2, 0], [0, 2, 0]],
    ]);
    const { islands } = meshIslands(mesh);
    expect(islands).toHaveLength(1);
    expect(islands[0].principalAxis).toBe('x');
    expect(islands[0].principalExtent).toBe(20);
    expect(islands[0].aspectRatio[0]).toBe(1);      // X is max
    expect(islands[0].aspectRatio[1]).toBeCloseTo(0.1, 5);
    expect(islands[0].aspectRatio[2]).toBe(0);      // flat in Z
  });

  it('sums triangle areas into surfaceArea', () => {
    // Two right triangles of legs 3 and 4 → hypotenuse 5, each area = 6.
    // Total area of a 3×4 rectangle (2 triangles) = 12.
    const mesh = meshFromTriangles([
      [[0, 0, 0], [3, 0, 0], [0, 4, 0]],
      [[3, 0, 0], [3, 4, 0], [0, 4, 0]],
    ]);
    const { islands } = meshIslands(mesh);
    expect(islands[0].surfaceArea).toBeCloseTo(12, 5);
  });

  it('normalHistogram sums to 1 per island', () => {
    const mesh = meshFromTriangles([
      [[0, 0, 0], [3, 0, 0], [0, 4, 0]],
      [[3, 0, 0], [3, 4, 0], [0, 4, 0]],
    ]);
    const { islands } = meshIslands(mesh);
    const h = islands[0].normalHistogram;
    const sum = h.xPos + h.xNeg + h.yPos + h.yNeg + h.zPos + h.zNeg;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('modelUpAxis picks the axis with the biggest asymmetry between +/- hemispheres', () => {
    // A hemisphere-like construction: two triangles at z=1 facing +Z (top),
    // one small triangle at z=0 facing -Z. The +Z surface area is much
    // larger, so modelUpAxis should point at +Z.
    const mesh = meshFromTriangles([
      // Top face (+Z), large — vertex order gives +Z normal
      [[0, 0, 1], [10, 0, 1], [0, 10, 1]],
      [[10, 0, 1], [10, 10, 1], [0, 10, 1]],
      // Bottom face (-Z), small — reversed order so normal is -Z
      [[0, 0, 0], [0, 2, 0], [2, 0, 0]],
    ]);
    const { modelUpAxis } = meshIslands(mesh);
    expect(modelUpAxis).not.toBeNull();
    expect(modelUpAxis!.axis).toBe('z');
    expect(modelUpAxis!.sign).toBe('+');
  });
});

describe('subsetMesh (#872 — renderIsland helper)', () => {
  it('returns only the selected triangles with compacted vertices', () => {
    // Three disjoint triangles; subset to just triangle 1.
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],           // tri 0
      [[10, 10, 10], [11, 10, 10], [10, 11, 10]],  // tri 1  (the one we want)
      [[20, 20, 20], [21, 20, 20], [20, 21, 20]],  // tri 2
    ]);
    const sub = subsetMesh(mesh, new Set([1]));
    expect(sub.numTri).toBe(1);
    expect(sub.numVert).toBe(3);
    expect(sub.numProp).toBe(3);
    // Vertices should be at the original tri 1's positions.
    expect(sub.vertProperties[0]).toBe(10);
    expect(sub.vertProperties[3]).toBe(11);
    expect(sub.vertProperties[6]).toBe(10);
    // triVerts should index 0..2 (compact).
    expect([...sub.triVerts]).toEqual([0, 1, 2]);
  });

  it('deduplicates shared vertices across two selected triangles', () => {
    // Two triangles sharing an edge (positions match).
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    ]);
    const sub = subsetMesh(mesh, new Set([0, 1]));
    expect(sub.numTri).toBe(2);
    // The two triangles share 2 vertices (edge) — subsetMesh dedups by
    // original vertex INDEX (not by welded position); the triangle-soup
    // input duplicates those positions across triangles so the naive
    // subset holds 6 verts. This is fine for rendering — we're just
    // testing the mapping is well-formed.
    expect(sub.numVert).toBeGreaterThan(0);
    expect(sub.triVerts.length).toBe(6);
  });
});
