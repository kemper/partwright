// Brush kernels — pure functions that mutate a MeshData's vertex
// positions in place for a single stroke sample. Triangle connectivity
// (triVerts) is never touched, which is the invariant that keeps the
// mesh manifold across an arbitrary stroke history.
//
// All distances are Euclidean to the stroke point. We deliberately
// avoid geodesic-on-surface measurement: it's expensive and the visual
// difference is subtle at typical brush radii.

import type { MeshData } from '../geometry/types';

/** Smoothstep falloff: 1 at the center, 0 at distance >= radius.
 *  Cubic so the brush eases in/out without a hard rim. */
function falloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = 1 - Math.min(1, distance / radius);
  return t * t * (3 - 2 * t);
}

/** Push brush — offset each in-range vertex along the supplied surface
 *  normal by `strength * falloff(d, radius)`. Negative strength is a
 *  pull. The normal is fixed per stroke sample (the surface normal
 *  under the cursor at click time), so a long stroke across a curved
 *  surface effectively paints displacement in the original cursor's
 *  reference direction — close enough for clay-style feedback.
 *  Mutates `mesh.vertProperties` in place and returns the same mesh. */
export function applyPush(
  mesh: MeshData,
  point: [number, number, number],
  normal: [number, number, number],
  radius: number,
  strength: number,
): MeshData {
  const { vertProperties, numVert, numProp } = mesh;
  const r2 = radius * radius;
  const px = point[0], py = point[1], pz = point[2];
  const nx = normal[0], ny = normal[1], nz = normal[2];

  for (let i = 0; i < numVert; i++) {
    const off = i * numProp;
    const dx = vertProperties[off] - px;
    const dy = vertProperties[off + 1] - py;
    const dz = vertProperties[off + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const w = falloff(Math.sqrt(d2), radius) * strength;
    vertProperties[off] += nx * w;
    vertProperties[off + 1] += ny * w;
    vertProperties[off + 2] += nz * w;
  }

  return mesh;
}

/** Smooth brush — move each in-range vertex toward the average of its
 *  1-ring neighbors, weighted by `strength * falloff`. We build the
 *  1-ring index from `triVerts` once per call (cheap; O(numTri)). */
export function applySmooth(
  mesh: MeshData,
  point: [number, number, number],
  radius: number,
  strength: number,
  iterations = 1,
): MeshData {
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const r2 = radius * radius;
  const px = point[0], py = point[1], pz = point[2];

  // 1-ring adjacency: for each vertex, the set of vertices it shares
  // an edge with. Built from triangle edges; dedup via Set so we don't
  // double-weight neighbors from two-triangle edges.
  const neighbors: Set<number>[] = new Array(numVert);
  for (let v = 0; v < numVert; v++) neighbors[v] = new Set();
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3];
    const b = triVerts[t * 3 + 1];
    const c = triVerts[t * 3 + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Snapshot current positions so the smooth step uses the previous
    // state (Jacobi-style) instead of seeing in-progress updates.
    const snapshot = new Float32Array(vertProperties);

    for (let i = 0; i < numVert; i++) {
      const off = i * numProp;
      const dx = snapshot[off] - px;
      const dy = snapshot[off + 1] - py;
      const dz = snapshot[off + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const ring = neighbors[i];
      if (ring.size === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const j of ring) {
        const jo = j * numProp;
        ax += snapshot[jo];
        ay += snapshot[jo + 1];
        az += snapshot[jo + 2];
      }
      ax /= ring.size;
      ay /= ring.size;
      az /= ring.size;
      const w = falloff(Math.sqrt(d2), radius) * strength;
      vertProperties[off] = snapshot[off] + (ax - snapshot[off]) * w;
      vertProperties[off + 1] = snapshot[off + 1] + (ay - snapshot[off + 1]) * w;
      vertProperties[off + 2] = snapshot[off + 2] + (az - snapshot[off + 2]) * w;
    }
  }

  return mesh;
}

/** Clone a mesh so brush operations don't mutate the source. The
 *  `vertProperties` buffer is the only thing brushes touch, so we copy
 *  that and reuse the immutable triVerts. */
export function cloneMesh(mesh: MeshData): MeshData {
  return {
    ...mesh,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: mesh.triVerts,
  };
}
