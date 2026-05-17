// Pure mesh-deformation functions. Each takes a MeshData + triangle-id set
// and returns a new MeshData whose triVerts (connectivity) is identical and
// whose vertProperties have been mutated in place along the touched vertices.
//
// Keeping connectivity untouched is what lets us round-trip the result back
// through Manifold.ofMesh() without re-triangulating — if every triangle that
// existed before still exists, the mesh stays manifold by construction.

import type { MeshData } from '../geometry/types';

/** Collect the unique vertex indices touched by any triangle in `triangleIds`. */
function gatherTouchedVertices(mesh: MeshData, triangleIds: Set<number>): Set<number> {
  const { triVerts } = mesh;
  const out = new Set<number>();
  for (const t of triangleIds) {
    out.add(triVerts[t * 3]);
    out.add(triVerts[t * 3 + 1]);
    out.add(triVerts[t * 3 + 2]);
  }
  return out;
}

/** Compute per-vertex normals as the area-weighted average of incident face
 *  normals. Length-3 floats per vertex, in the same indexing as vertProperties.
 *  We compute over the WHOLE mesh (not just the touched subset) because a
 *  boundary vertex of the region needs neighbouring-triangle normals too. */
function computeVertexNormals(mesh: MeshData): Float32Array {
  const { vertProperties, triVerts, numVert, numTri, numProp } = mesh;
  const normals = new Float32Array(numVert * 3);

  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3];
    const i1 = triVerts[t * 3 + 1];
    const i2 = triVerts[t * 3 + 2];

    const ax = vertProperties[i0 * numProp];
    const ay = vertProperties[i0 * numProp + 1];
    const az = vertProperties[i0 * numProp + 2];
    const bx = vertProperties[i1 * numProp];
    const by = vertProperties[i1 * numProp + 1];
    const bz = vertProperties[i1 * numProp + 2];
    const cx = vertProperties[i2 * numProp];
    const cy = vertProperties[i2 * numProp + 1];
    const cz = vertProperties[i2 * numProp + 2];

    // Edge vectors AB, AC
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;

    // Cross product = unnormalized face normal, magnitude = 2 * area.
    // Accumulating the raw cross product naturally area-weights it.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    normals[i0 * 3] += nx;
    normals[i0 * 3 + 1] += ny;
    normals[i0 * 3 + 2] += nz;
    normals[i1 * 3] += nx;
    normals[i1 * 3 + 1] += ny;
    normals[i1 * 3 + 2] += nz;
    normals[i2 * 3] += nx;
    normals[i2 * 3 + 1] += ny;
    normals[i2 * 3 + 2] += nz;
  }

  // Normalize
  for (let v = 0; v < numVert; v++) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      normals[v * 3] = x / len;
      normals[v * 3 + 1] = y / len;
      normals[v * 3 + 2] = z / len;
    }
  }

  return normals;
}

/** Clone the mesh's vertProperties + triVerts buffers so we can mutate the
 *  positions safely. The other fields (mergeFromVert, runIndex, etc.) are
 *  carried over by reference — they don't change shape under a deformer that
 *  only nudges vertex positions. */
function cloneMeshForEdit(mesh: MeshData): MeshData {
  return {
    ...mesh,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
  };
}

/** Offset each vertex touched by any triangle in `triangleIds` along its
 *  area-weighted vertex normal by `distance`. Other vertices are untouched. */
export function applyInflate(
  mesh: MeshData,
  triangleIds: Set<number>,
  distance: number,
): MeshData {
  if (triangleIds.size === 0 || distance === 0) return mesh;

  const touched = gatherTouchedVertices(mesh, triangleIds);
  const normals = computeVertexNormals(mesh);

  const out = cloneMeshForEdit(mesh);
  const { numProp } = out;
  for (const v of touched) {
    out.vertProperties[v * numProp]     += normals[v * 3]     * distance;
    out.vertProperties[v * numProp + 1] += normals[v * 3 + 1] * distance;
    out.vertProperties[v * numProp + 2] += normals[v * 3 + 2] * distance;
  }
  return out;
}

/** Build a vertex 1-ring adjacency list (each vertex -> set of neighbour
 *  vertices it shares an edge with), restricted to the supplied triangle set.
 *  The restriction matters: smoothing a region should not pull boundary
 *  vertices toward neighbours that sit outside the region (those still
 *  exist in the mesh, but they're not part of "this region's surface"). */
function buildVertexRingRestricted(
  mesh: MeshData,
  triangleIds: Set<number>,
): Map<number, Set<number>> {
  const { triVerts } = mesh;
  const ring = new Map<number, Set<number>>();

  function addEdge(a: number, b: number): void {
    let sa = ring.get(a);
    if (!sa) { sa = new Set(); ring.set(a, sa); }
    sa.add(b);
    let sb = ring.get(b);
    if (!sb) { sb = new Set(); ring.set(b, sb); }
    sb.add(a);
  }

  for (const t of triangleIds) {
    const i0 = triVerts[t * 3];
    const i1 = triVerts[t * 3 + 1];
    const i2 = triVerts[t * 3 + 2];
    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  return ring;
}

/** Laplacian smoothing of the touched-vertex set. Each iteration replaces
 *  the touched vertex positions with the average of their region-restricted
 *  1-ring neighbours.
 *
 *  Boundary vertices of the region are pinned: a touched vertex that also
 *  appears in a triangle OUTSIDE the region is held in place, so smoothing
 *  can't pull the region away from the rest of the mesh and tear it. */
export function applySmooth(
  mesh: MeshData,
  triangleIds: Set<number>,
  iterations: number,
): MeshData {
  if (triangleIds.size === 0 || iterations <= 0) return mesh;

  // All vertices touched by any region triangle
  const inRegion = gatherTouchedVertices(mesh, triangleIds);

  // Find vertices that appear in a triangle OUTSIDE the region — those
  // are the region boundary; pinning them prevents tearing.
  const allTris = mesh.numTri;
  const pinned = new Set<number>();
  for (let t = 0; t < allTris; t++) {
    if (triangleIds.has(t)) continue;
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    if (inRegion.has(i0)) pinned.add(i0);
    if (inRegion.has(i1)) pinned.add(i1);
    if (inRegion.has(i2)) pinned.add(i2);
  }

  // Build region-restricted 1-ring (so we average over the surface of the
  // selection, not the whole mesh).
  const ring = buildVertexRingRestricted(mesh, triangleIds);

  const movable: number[] = [];
  for (const v of inRegion) {
    if (!pinned.has(v)) movable.push(v);
  }

  // Nothing to do — region is a single triangle whose three corners are
  // all on the boundary, or smoothing has no neighbours.
  if (movable.length === 0) return mesh;

  const out = cloneMeshForEdit(mesh);
  const { numProp } = out;

  // Use two buffers and swap each iteration so each vertex's update is
  // based on the previous iteration's positions (Jacobi-style, simpler
  // and more stable for our small iteration counts than Gauss-Seidel).
  let current = out.vertProperties;
  let next = new Float32Array(current);

  for (let it = 0; it < iterations; it++) {
    next.set(current);
    for (const v of movable) {
      const neighbours = ring.get(v);
      if (!neighbours || neighbours.size === 0) continue;

      let sx = 0, sy = 0, sz = 0;
      for (const n of neighbours) {
        sx += current[n * numProp];
        sy += current[n * numProp + 1];
        sz += current[n * numProp + 2];
      }
      const inv = 1 / neighbours.size;
      next[v * numProp]     = sx * inv;
      next[v * numProp + 1] = sy * inv;
      next[v * numProp + 2] = sz * inv;
    }
    // Swap
    const tmp = current;
    current = next;
    next = tmp;
  }

  out.vertProperties = current;
  return out;
}
