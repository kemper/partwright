// Triangle midpoint subdivision — each triangle becomes 4 smaller
// triangles by splitting every edge at its midpoint. Pure function;
// preserves manifoldness because every edge is split consistently for
// both triangles that share it (midpoints are deduped by edge key).

import type { MeshData } from '../geometry/types';

/** Split each triangle of `mesh` into 4 by inserting a new vertex at
 *  the midpoint of every edge. The output has the same connectivity as
 *  the input (same boundary, same topology) but ~4x as many tris and
 *  vertices growing roughly proportionally. Per-vertex properties past
 *  the position triplet are linearly averaged. */
export function subdivide(mesh: MeshData, levels: number): MeshData {
  if (!Number.isFinite(levels) || levels <= 0) return mesh;
  let current = mesh;
  for (let i = 0; i < levels; i++) {
    current = subdivideOnce(current);
  }
  return current;
}

function subdivideOnce(mesh: MeshData): MeshData {
  const { vertProperties, triVerts, numTri, numProp } = mesh;

  // Copy original vertex properties; new midpoint vertices append after.
  const positions: number[] = Array.from(vertProperties);
  // Map "edgeKey -> midpoint vertex index" so an edge shared by two
  // triangles produces the same midpoint vertex (manifold-preserving).
  const midpointCache = new Map<string, number>();

  const edgeKey = (a: number, b: number): string =>
    a < b ? `${a},${b}` : `${b},${a}`;

  function getOrCreateMidpoint(a: number, b: number): number {
    const key = edgeKey(a, b);
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const idx = positions.length / numProp;
    // Average every property channel — positions first, plus any
    // extras (UVs, etc.) the mesh might carry.
    for (let p = 0; p < numProp; p++) {
      const va = vertProperties[a * numProp + p];
      const vb = vertProperties[b * numProp + p];
      positions.push((va + vb) * 0.5);
    }
    midpointCache.set(key, idx);
    return idx;
  }

  const newTris: number[] = [];

  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3];
    const b = triVerts[t * 3 + 1];
    const c = triVerts[t * 3 + 2];

    const ab = getOrCreateMidpoint(a, b);
    const bc = getOrCreateMidpoint(b, c);
    const ca = getOrCreateMidpoint(c, a);

    // 4 sub-triangles, all wound the same way as the parent so
    // outward-facing normals are preserved.
    newTris.push(a, ab, ca);
    newTris.push(b, bc, ab);
    newTris.push(c, ca, bc);
    newTris.push(ab, bc, ca);
  }

  const newNumVert = positions.length / numProp;
  const newNumTri = newTris.length / 3;

  return {
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(newTris),
    numVert: newNumVert,
    numTri: newNumTri,
    numProp,
    // Subdivision invalidates merge / run metadata — strip it.
  };
  // `numVert: newNumVert` and the rest mirror the source mesh shape.
}
