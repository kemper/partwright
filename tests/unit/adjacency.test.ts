import { describe, it, expect } from 'vitest';
import { buildAdjacency } from '../../src/color/adjacency';
import type { MeshData } from '../../src/geometry/types';

/** The original Map/Set implementation, kept as the reference the typed-array
 *  rewrite must match (same neighbour sets, any order). */
function referenceNeighbors(mesh: MeshData): Set<number>[] {
  const { triVerts, numTri, numVert, vertProperties, numProp } = mesh;
  const posId = new Map<string, number>();
  const vertCanon = new Int32Array(numVert);
  for (let v = 0; v < numVert; v++) {
    const key = `${vertProperties[v * numProp]},${vertProperties[v * numProp + 1]},${vertProperties[v * numProp + 2]}`;
    let id = posId.get(key);
    if (id === undefined) { id = posId.size; posId.set(key, id); }
    vertCanon[v] = id;
  }
  const vertToTris = new Map<number, number[]>();
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const pid = vertCanon[triVerts[t * 3 + k]];
      let list = vertToTris.get(pid);
      if (!list) { list = []; vertToTris.set(pid, list); }
      list.push(t);
    }
  }
  const neighbors: Set<number>[] = Array.from({ length: numTri }, () => new Set<number>());
  for (const tris of vertToTris.values()) {
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        if (tris[i] === tris[j]) continue;
        neighbors[tris[i]].add(tris[j]);
        neighbors[tris[j]].add(tris[i]);
      }
    }
  }
  return neighbors;
}

/** A grid of quads where every triangle gets its own vertex copies (the
 *  "coincident-but-split" render-mesh case), with a -0 coordinate thrown in. */
function splitGrid(n: number): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const push = (x: number, y: number): number => {
    verts.push(x === 0 ? -0 : x, y, 0);
    return verts.length / 3 - 1;
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      tris.push(push(i, j), push(i + 1, j), push(i + 1, j + 1));
      tris.push(push(i, j), push(i + 1, j + 1), push(i, j + 1));
    }
  }
  // Add one shared-index fan on top so indices are not all unique.
  const c = push(n + 2, n + 2);
  const a = push(n + 3, n + 2);
  const b = push(n + 3, n + 3);
  const d = push(n + 2, n + 3);
  tris.push(c, a, b, c, b, d);
  return {
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numVert: verts.length / 3,
    numTri: tris.length / 3,
  } as MeshData;
}

describe('buildAdjacency', () => {
  it('matches the reference corner-adjacency on a split-vertex mesh', () => {
    const mesh = splitGrid(12);
    const got = buildAdjacency(mesh);
    const want = referenceNeighbors(mesh);
    expect(got.neighbors.length).toBe(mesh.numTri);
    for (let t = 0; t < mesh.numTri; t++) {
      expect(new Set(got.neighbors[t])).toEqual(want[t]);
      expect(got.neighbors[t].length).toBe(want[t].size); // no duplicates
    }
  });

  it('treats +0 and -0 as the same position', () => {
    const mesh: MeshData = {
      numProp: 3,
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -0, -0, -0, 1, 1, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 5]),
      numVert: 6,
      numTri: 2,
    } as MeshData;
    const { neighbors } = buildAdjacency(mesh);
    expect([...neighbors[0]]).toEqual([1]);
    expect([...neighbors[1]]).toEqual([0]);
  });
});
