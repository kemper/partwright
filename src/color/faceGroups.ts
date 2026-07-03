// Face groups — partition the mesh into coplanar (or near-coplanar) regions
// and report each group's centroid, area, normal, and bounding box. This gives
// agents a structural overview of large face groups so they can target paint
// operations procedurally instead of guessing exact seed points.

import type { MeshData } from '../geometry/types';
import { buildAdjacency, findCoplanarRegion, type AdjacencyGraph } from './adjacency';

export interface FaceGroup {
  /** Stable index assigned by traversal order. */
  id: number;
  /** Average outward-pointing unit normal (area-weighted). */
  normal: [number, number, number];
  /** Area-weighted centroid in world coordinates. */
  centroid: [number, number, number];
  /** Sum of triangle areas in this group. */
  area: number;
  /** Number of triangles in this group. */
  triangleCount: number;
  /** Axis-aligned bounding box of the group's triangles. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Triangle indices belonging to this group. Capped by `maxTrianglesPerGroup`. */
  triangleIds: number[];
  /** Largest single-triangle area in the group. A value much bigger than
   *  `medianTriangleArea` (say 20×) is the fan-topology signature: long
   *  radial wedges whose centroids sit inside the feature but whose tips
   *  span far outside it — painting the raw triangle set will bleed. */
  maxTriangleArea: number;
  /** Median triangle area — the "typical" tessellation density, robust to a
   *  handful of giant wedges. Compare against `maxTriangleArea`. */
  medianTriangleArea: number;
  /** Worst (largest) triangle aspect ratio in the group: longest edge over
   *  the altitude to that edge (`longestEdge² / (2·area)`). An equilateral
   *  triangle scores ≈1.15; a healthy mesh stays under ~4; radial fan wedges
   *  and slivers run 10+. */
  worstTriangleAspectRatio: number;
  /** Ids of groups this group shares a crease boundary with. Present only
   *  when `includeNeighborIds: true` was passed to `computeFaceGroups`. */
  neighborIds?: number[];
}

export interface FaceGroupSummary {
  groups: FaceGroup[];
  /** Total triangles in the mesh (sum of triangleCount across all groups). */
  totalTriangles: number;
  /** Tolerance used to compute the grouping. */
  tolerance: number;
}

interface FaceGroupOptions {
  /** Cosine bend tolerance for the BFS that gathers each group. Default 0.9995 (≈1.8°).
   *  Use `~0.94` (cos 20°) for sculpt-feature segmentation (iris ring, mouth crease, etc.). */
  tolerance?: number;
  /** Skip groups smaller than this many triangles. Default 1 (return everything). */
  minTriangles?: number;
  /** Maximum number of triangle indices to include per group. Default 64.
   *  Set to 0 to omit triangle ids and keep only summary stats. */
  maxTrianglesPerGroup?: number;
  /** Maximum number of groups to return (largest by triangle count first).
   *  Default 256 — large enough for typical models. Set 0 for unlimited. */
  maxGroups?: number;
  /** Optional triangle-id restriction. Only seed triangles in this set are
   *  considered, and the BFS won't walk into triangles outside it. Use to
   *  segment a single mesh-island (fused body part) rather than the whole
   *  mesh — e.g. pass the result of `trianglesInIsland(triIslands, idx)`. */
  restrictTo?: Set<number>;
  /** When true, each group gets a `neighborIds: number[]` field listing the
   *  ids of every group it shares at least one crease boundary with. Computed
   *  by walking each group's boundary triangles and cross-referencing the
   *  group assignment of their cross-crease neighbours. ~30 lines, O(triangles). */
  includeNeighborIds?: boolean;
}

export function computeFaceGroups(mesh: MeshData, options?: FaceGroupOptions): FaceGroupSummary {
  const tolerance = options?.tolerance ?? 0.9995;
  const minTriangles = Math.max(1, options?.minTriangles ?? 1);
  const maxTrianglesPerGroup = options?.maxTrianglesPerGroup ?? 64;
  const maxGroups = options?.maxGroups ?? 256;
  const restrictTo = options?.restrictTo;
  const includeNeighborIds = options?.includeNeighborIds ?? false;

  const adjacency = buildAdjacency(mesh);
  const visited = new Uint8Array(mesh.numTri);
  // Pre-mark every triangle OUTSIDE the restriction set as visited so the
  // outer-loop seed scan skips them AND the per-triangle resolver below maps
  // them to NO_GROUP (= no neighbour cross-reference into them).
  if (restrictTo) {
    for (let t = 0; t < mesh.numTri; t++) if (!restrictTo.has(t)) visited[t] = 1;
  }
  const groups: FaceGroup[] = [];
  const triToGroup = includeNeighborIds ? new Int32Array(mesh.numTri).fill(-1) : null;

  for (let seed = 0; seed < mesh.numTri; seed++) {
    if (visited[seed]) continue;
    const triangles = restrictTo
      ? findCoplanarRegionConstrained(seed, adjacency, tolerance, restrictTo)
      : findCoplanarRegion(seed, adjacency, tolerance);
    for (const t of triangles) visited[t] = 1;
    if (triangles.size < minTriangles) continue;
    const group = buildGroup(groups.length, triangles, mesh, adjacency, maxTrianglesPerGroup);
    if (triToGroup) for (const t of triangles) triToGroup[t] = group.id;
    groups.push(group);
  }

  // Largest groups first so an agent that only inspects the top N gets the
  // most structurally significant faces.
  groups.sort((a, b) => b.triangleCount - a.triangleCount);
  // Rewrite ids to match the post-sort order, then re-key triToGroup so
  // neighbour lookups still hit the right group.
  if (triToGroup) {
    const oldToNew = new Int32Array(groups.length);
    for (let i = 0; i < groups.length; i++) oldToNew[groups[i].id] = i;
    for (let t = 0; t < mesh.numTri; t++) {
      if (triToGroup[t] >= 0) triToGroup[t] = oldToNew[triToGroup[t]];
    }
  }
  for (let i = 0; i < groups.length; i++) groups[i].id = i;

  // Cross-crease neighbour graph: for each triangle in group G, any neighbour
  // belonging to a different group H means G and H share a boundary. Cheap
  // and exact over the adjacency we already built.
  if (triToGroup) {
    const seen: Set<number>[] = groups.map(() => new Set<number>());
    for (let t = 0; t < mesh.numTri; t++) {
      const g = triToGroup[t];
      if (g < 0) continue;
      const ns = adjacency.neighbors[t];
      for (let i = 0; i < ns.length; i++) {
        const h = triToGroup[ns[i]];
        if (h >= 0 && h !== g) seen[g].add(h);
      }
    }
    for (let i = 0; i < groups.length; i++) groups[i].neighborIds = [...seen[i]].sort((a, b) => a - b);
  }

  const trimmed = maxGroups > 0 ? groups.slice(0, maxGroups) : groups;

  return {
    groups: trimmed,
    totalTriangles: mesh.numTri,
    tolerance,
  };
}

/** BFS variant of `findCoplanarRegion` that won't walk outside `allowed`. The
 *  adjacent-pair crease gate is unchanged; the constraint just prunes the
 *  walk to one island's triangles. */
function findCoplanarRegionConstrained(
  seedTri: number,
  adjacency: AdjacencyGraph,
  normalTolerance: number,
  allowed: Set<number>,
): Set<number> {
  const { neighbors, normals } = adjacency;
  const result = new Set<number>();
  if (!allowed.has(seedTri)) return result;
  result.add(seedTri);
  const stack = [seedTri];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const cnx = normals[current * 3];
    const cny = normals[current * 3 + 1];
    const cnz = normals[current * 3 + 2];
    const adj = neighbors[current];
    for (let i = 0; i < adj.length; i++) {
      const nb = adj[i];
      if (result.has(nb) || !allowed.has(nb)) continue;
      const dot = cnx * normals[nb * 3] + cny * normals[nb * 3 + 1] + cnz * normals[nb * 3 + 2];
      if (dot >= normalTolerance) {
        result.add(nb);
        stack.push(nb);
      }
    }
  }
  return result;
}

function buildGroup(
  id: number,
  triangles: Set<number>,
  mesh: MeshData,
  adjacency: AdjacencyGraph,
  maxIds: number,
): FaceGroup {
  const { triVerts, vertProperties, numProp } = mesh;

  let cx = 0, cy = 0, cz = 0;
  let nx = 0, ny = 0, nz = 0;
  let totalArea = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const ids: number[] = [];
  const areas: number[] = [];
  let maxArea = 0;
  let worstAspect = 0;

  for (const t of triangles) {
    if (maxIds === 0 ? false : ids.length < maxIds) ids.push(t);

    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    const ax = vertProperties[v0 * numProp];
    const ay = vertProperties[v0 * numProp + 1];
    const az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp];
    const by = vertProperties[v1 * numProp + 1];
    const bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp];
    const cy2 = vertProperties[v2 * numProp + 1];
    const cz2 = vertProperties[v2 * numProp + 2];

    if (ax < minX) minX = ax; if (ay < minY) minY = ay; if (az < minZ) minZ = az;
    if (bx < minX) minX = bx; if (by < minY) minY = by; if (bz < minZ) minZ = bz;
    if (cx2 < minX) minX = cx2; if (cy2 < minY) minY = cy2; if (cz2 < minZ) minZ = cz2;
    if (ax > maxX) maxX = ax; if (ay > maxY) maxY = ay; if (az > maxZ) maxZ = az;
    if (bx > maxX) maxX = bx; if (by > maxY) maxY = by; if (bz > maxZ) maxZ = bz;
    if (cx2 > maxX) maxX = cx2; if (cy2 > maxY) maxY = cy2; if (cz2 > maxZ) maxZ = cz2;

    // Triangle area = 0.5 * |AB x AC|
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);

    areas.push(area);
    if (area > maxArea) maxArea = area;
    // Aspect ratio = longest edge / altitude-to-it = longestEdge² / (2·area).
    // Degenerate (zero-area) triangles score Infinity → clamp to a large
    // finite sentinel so JSON serialisation stays sane.
    const l1 = e1x * e1x + e1y * e1y + e1z * e1z;
    const l2 = e2x * e2x + e2y * e2y + e2z * e2z;
    const e3x = cx2 - bx, e3y = cy2 - by, e3z = cz2 - bz;
    const l3 = e3x * e3x + e3y * e3y + e3z * e3z;
    const longestSq = Math.max(l1, l2, l3);
    const aspect = area > 0 ? longestSq / (2 * area) : 1e6;
    if (aspect > worstAspect) worstAspect = aspect;

    const triCx = (ax + bx + cx2) / 3;
    const triCy = (ay + by + cy2) / 3;
    const triCz = (az + bz + cz2) / 3;
    cx += triCx * area;
    cy += triCy * area;
    cz += triCz * area;

    nx += adjacency.normals[t * 3] * area;
    ny += adjacency.normals[t * 3 + 1] * area;
    nz += adjacency.normals[t * 3 + 2] * area;

    totalArea += area;
  }

  const safeArea = totalArea > 0 ? totalArea : 1;
  const centroid: [number, number, number] = [cx / safeArea, cy / safeArea, cz / safeArea];

  const nLen = Math.hypot(nx, ny, nz);
  const normal: [number, number, number] = nLen > 0
    ? [nx / nLen, ny / nLen, nz / nLen]
    : [0, 0, 0];

  areas.sort((a, b) => a - b);
  const medianArea = areas.length > 0
    ? (areas.length % 2 === 1
        ? areas[(areas.length - 1) / 2]
        : (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2)
    : 0;

  return {
    id,
    normal,
    centroid,
    area: totalArea,
    triangleCount: triangles.size,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    triangleIds: ids,
    maxTriangleArea: maxArea,
    medianTriangleArea: medianArea,
    worstTriangleAspectRatio: worstAspect,
  };
}
