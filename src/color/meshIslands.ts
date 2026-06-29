// Mesh islands — face-connected topological components of a triangle mesh.
//
// The voxel engine has `voxelPieceCount` (6-neighbour BFS over the grid); this
// is the triangle-mesh analog. It runs on ANY MeshData regardless of manifold
// status, so a render-only STL import (which can't use `Manifold.decompose()`)
// can still be split into its constituent parts for painting and bbox queries.
//
// We reuse `buildAdjacency` for the underlying graph: it welds vertices by
// exact position before walking, so coincident-but-split vertex copies (common
// in STL triangle soups, where every facet stores its own three vertices) get
// joined into a single island instead of fragmenting into 100k singletons.
//
// LIMITATION: parts that physically touch at a shared vertex (a hat brim
// resting on a head) appear as one island because the welded adjacency can't
// tell them apart. This matches `Manifold.decompose()`'s behaviour and is
// unavoidable without external part metadata. For print-in-place / articulated
// kits where parts have clearance gaps (the common case), island detection
// matches each part exactly.
//
// Results are memoized on a WeakMap keyed by the MeshData reference. A new
// engine run produces a fresh MeshData, so the cache invalidates implicitly.

import { buildAdjacency } from './adjacency';
import type { MeshData } from '../geometry/types';

export interface MeshIsland {
  /** Stable index 0..N-1 within this mesh's island list. */
  index: number;
  /** Number of triangles in this island. */
  triangleCount: number;
  /** Axis-aligned bounding box of the island's vertices. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Bbox centre (not the centroid of triangles). Cheap and good enough for
   *  "where is this island in space" — what the AI needs to label parts. */
  center: [number, number, number];
}

export interface MeshIslandsResult {
  /** Per-triangle island id, length = mesh.numTri. */
  triIslands: Uint32Array;
  /** Per-island metadata. */
  islands: MeshIsland[];
}

const cache = new WeakMap<MeshData, MeshIslandsResult>();

/** Compute (or fetch from cache) the face-connected island decomposition of
 *  `mesh`. Triangle adjacency uses `buildAdjacency`'s welded-by-position
 *  graph, so coincident vertex copies don't fragment a single island. */
export function meshIslands(mesh: MeshData): MeshIslandsResult {
  const cached = cache.get(mesh);
  if (cached) return cached;
  const result = compute(mesh);
  cache.set(mesh, result);
  return result;
}

/** Clear the WeakMap entry for a mesh — useful in tests; the WeakMap drops
 *  entries automatically when the mesh is garbage-collected, so production
 *  code doesn't need this. */
export function clearMeshIslandsCache(mesh?: MeshData): void {
  if (mesh) cache.delete(mesh);
}

function compute(mesh: MeshData): MeshIslandsResult {
  const { numTri } = mesh;
  const triIslands = new Uint32Array(numTri);
  if (numTri === 0) return { triIslands, islands: [] };

  // Sentinel: 0xFFFFFFFF = unvisited. (Real island ids start at 0 and we
  // won't ever hit 2^32-1 islands.)
  triIslands.fill(0xFFFFFFFF);

  const adjacency = buildAdjacency(mesh);
  const { neighbors } = adjacency;
  const { triVerts, vertProperties, numProp } = mesh;

  const islands: MeshIsland[] = [];
  const stack: number[] = [];

  for (let seed = 0; seed < numTri; seed++) {
    if (triIslands[seed] !== 0xFFFFFFFF) continue;
    const islandIdx = islands.length;
    triIslands[seed] = islandIdx;
    stack.push(seed);

    let triCount = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    while (stack.length > 0) {
      const t = stack.pop()!;
      triCount++;
      // Accumulate bbox from the triangle's three vertices.
      for (let k = 0; k < 3; k++) {
        const v = triVerts[t * 3 + k];
        const x = vertProperties[v * numProp];
        const y = vertProperties[v * numProp + 1];
        const z = vertProperties[v * numProp + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      const ns = neighbors[t];
      for (let i = 0; i < ns.length; i++) {
        const nb = ns[i];
        if (triIslands[nb] === 0xFFFFFFFF) {
          triIslands[nb] = islandIdx;
          stack.push(nb);
        }
      }
    }

    islands.push({
      index: islandIdx,
      triangleCount: triCount,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    });
  }

  return { triIslands, islands };
}

/** Collect every triangle id belonging to the given island. */
export function trianglesInIsland(triIslands: Uint32Array, islandIndex: number): Set<number> {
  const out = new Set<number>();
  for (let t = 0; t < triIslands.length; t++) {
    if (triIslands[t] === islandIndex) out.add(t);
  }
  return out;
}

/** Find the island id that owns the triangle closest to `point` (linear scan
 *  over triangle centroids). Returns -1 for an empty mesh. */
export function islandAtPoint(
  mesh: MeshData,
  point: [number, number, number],
): number {
  const { triIslands } = meshIslands(mesh);
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  if (numTri === 0) return -1;
  const [px, py, pz] = point;
  let bestT = -1;
  let bestD2 = Infinity;
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];
    const cx = (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3;
    const cy = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3;
    const cz = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3;
    const dx = cx - px, dy = cy - py, dz = cz - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
  }
  return bestT >= 0 ? triIslands[bestT] : -1;
}
