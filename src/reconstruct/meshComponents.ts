// Vertex weld + connected-component split on a triangle soup, plus the
// MeshData → soup adapter. Ported from scripts/inverse-cad/mesh.mjs.
//
// A "component" is a set of triangles whose vertices reach each other by
// walking triangle edges after welding. Two physically separate solids in
// one import land in different components; two solids sharing even one
// welded vertex merge — correct for a solid stored as touching halves.

import type { TriangleSoup } from './slice2d';

/** Indexed-mesh shape shared by MeshData and ImportedMesh. */
export interface IndexedMeshLike {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

/** Expand an indexed mesh (stride numProp, xyz first) into a triangle soup. */
export function toTriangleSoup(mesh: IndexedMeshLike): TriangleSoup {
  const stride = mesh.numProp || 3;
  const nTri = mesh.triVerts.length / 3;
  const triangles = new Float32Array(nTri * 9);
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.triVerts[t * 3 + k] * stride;
      const o = t * 9 + k * 3;
      triangles[o] = mesh.vertProperties[v];
      triangles[o + 1] = mesh.vertProperties[v + 1];
      triangles[o + 2] = mesh.vertProperties[v + 2];
    }
  }
  return { triangles };
}

export function meshBBox(mesh: TriangleSoup): { min: [number, number, number]; max: [number, number, number] } {
  const { triangles } = mesh;
  if (triangles.length === 0) throw new Error('meshBBox: empty mesh');
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = triangles[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function makeDSU(n: number): { find(x: number): number; union(a: number, b: number): void } {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

/**
 * Group triangles into connected components by shared welded vertices.
 * Returns soups in the original float-vertex encoding, sorted by triangle
 * count descending.
 */
export function connectedComponents(mesh: TriangleSoup, opts: { tol?: number } = {}): TriangleSoup[] {
  const tol = opts.tol ?? 1e-5;
  const inv = 1 / tol;
  const src = mesh.triangles;
  const vertexIds = new Int32Array(src.length / 3);
  const map = new Map<string, number>();
  let vertCount = 0;
  for (let i = 0, j = 0; i < src.length; i += 3, j++) {
    const key =
      Math.round(src[i] * inv) + ',' + Math.round(src[i + 1] * inv) + ',' + Math.round(src[i + 2] * inv);
    let id = map.get(key);
    if (id === undefined) {
      id = vertCount++;
      map.set(key, id);
    }
    vertexIds[j] = id;
  }

  const triCount = vertexIds.length / 3;
  const dsu = makeDSU(vertCount);
  for (let t = 0; t < triCount; t++) {
    dsu.union(vertexIds[t * 3], vertexIds[t * 3 + 1]);
    dsu.union(vertexIds[t * 3 + 1], vertexIds[t * 3 + 2]);
  }
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const root = dsu.find(vertexIds[t * 3]);
    let bucket = buckets.get(root);
    if (!bucket) {
      bucket = [];
      buckets.set(root, bucket);
    }
    const off = t * 9;
    for (let k = 0; k < 9; k++) bucket.push(src[off + k]);
  }
  const components: TriangleSoup[] = [];
  for (const arr of buckets.values()) {
    components.push({ triangles: Float32Array.from(arr) });
  }
  components.sort((a, b) => b.triangles.length - a.triangles.length);
  return components;
}
