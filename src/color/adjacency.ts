// Triangle adjacency and coplanar region finding

import type { MeshData } from '../geometry/types';

export interface AdjacencyGraph {
  /** For each triangle index, the list of adjacent triangle indices (sharing an edge). */
  neighbors: Uint32Array[];
  /** Triangle normals — 3 floats per triangle (nx, ny, nz). */
  normals: Float32Array;
  /** Triangle centroids — 3 floats per triangle (cx, cy, cz). Used by the
   *  brush tool's radius expansion (sphere query against centroids). */
  centroids: Float32Array;
}

/** Create a canonical edge key from two vertex indices (order-independent). */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Build a triangle adjacency graph from mesh data.
 *  O(numTri) with Map-based edge lookup. */
export function buildAdjacency(mesh: MeshData): AdjacencyGraph {
  const { triVerts, numTri, vertProperties, numProp } = mesh;

  // Build edge → triangle list map
  const edgeToTris = new Map<string, number[]>();

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    for (const key of [edgeKey(v0, v1), edgeKey(v1, v2), edgeKey(v2, v0)]) {
      let list = edgeToTris.get(key);
      if (!list) {
        list = [];
        edgeToTris.set(key, list);
      }
      list.push(t);
    }
  }

  // Build neighbor lists
  const neighbors: Set<number>[] = new Array(numTri);
  for (let i = 0; i < numTri; i++) neighbors[i] = new Set();

  for (const tris of edgeToTris.values()) {
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        neighbors[tris[i]].add(tris[j]);
        neighbors[tris[j]].add(tris[i]);
      }
    }
  }

  // Compute triangle normals
  const normals = new Float32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    const ax = vertProperties[v1 * numProp] - vertProperties[v0 * numProp];
    const ay = vertProperties[v1 * numProp + 1] - vertProperties[v0 * numProp + 1];
    const az = vertProperties[v1 * numProp + 2] - vertProperties[v0 * numProp + 2];

    const bx = vertProperties[v2 * numProp] - vertProperties[v0 * numProp];
    const by = vertProperties[v2 * numProp + 1] - vertProperties[v0 * numProp + 1];
    const bz = vertProperties[v2 * numProp + 2] - vertProperties[v0 * numProp + 2];

    // Cross product
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;

    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    normals[t * 3] = nx;
    normals[t * 3 + 1] = ny;
    normals[t * 3 + 2] = nz;
  }

  // Compute triangle centroids (mean of three vertex positions).
  const centroids = new Float32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];
    centroids[t * 3]     = (vertProperties[v0 * numProp]     + vertProperties[v1 * numProp]     + vertProperties[v2 * numProp])     / 3;
    centroids[t * 3 + 1] = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3;
    centroids[t * 3 + 2] = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3;
  }

  return {
    neighbors: neighbors.map(s => new Uint32Array(s)),
    normals,
    centroids,
  };
}

/** BFS from a seed triangle, crossing each edge only when the bend angle
 *  between the two faces sharing that edge is small enough — i.e. when
 *  `cos(angle) >= normalTolerance`. The tolerance is checked against the
 *  *parent* (already-visited) triangle's normal, not the seed's, so flood-fill
 *  follows curved surfaces (e.g. a cylinder side) where each adjacent face
 *  bends only a small amount even though the cumulative bend is large.
 *
 *  `normalTolerance` is in [-1, 1] — the cosine of the maximum allowed bend
 *  angle. 1 = strict (only exactly-coplanar faces); -1 = no limit (whole
 *  connected component). Default 0.9995 ≈ 1.8°. */
export function findCoplanarRegion(
  seedTri: number,
  adjacency: AdjacencyGraph,
  normalTolerance = 0.9995,
): Set<number> {
  const { neighbors, normals } = adjacency;
  const result = new Set<number>();

  const queue = [seedTri];
  result.add(seedTri);

  while (queue.length > 0) {
    const current = queue.pop()!;
    const cnx = normals[current * 3];
    const cny = normals[current * 3 + 1];
    const cnz = normals[current * 3 + 2];

    const adj = neighbors[current];
    for (let i = 0; i < adj.length; i++) {
      const neighbor = adj[i];
      if (result.has(neighbor)) continue;

      const nx = normals[neighbor * 3];
      const ny = normals[neighbor * 3 + 1];
      const nz = normals[neighbor * 3 + 2];

      const dot = cnx * nx + cny * ny + cnz * nz;
      if (dot >= normalTolerance) {
        result.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return result;
}

/** BFS from a seed triangle, accepting each neighbor whose normal is
 *  within `maxSeedDeviationDeg` of the SEED's normal — not the parent's.
 *
 *  This is the right primitive for "paint everything contiguous to my
 *  seed that's facing the same general direction." Unlike
 *  `findCoplanarRegion`, which compares each adjacent pair, the seed-
 *  relative threshold doesn't accumulate around curvature: a smooth
 *  cylinder side won't suck in the whole component when you pick a 30°
 *  deviation, because the floor for inclusion stays anchored to the
 *  seed orientation instead of drifting around the surface.
 *
 *  Both the seed triangle's own normal and every successive candidate
 *  must dot the seed normal >= `cos(maxSeedDeviationDeg)`. The seed
 *  triangle is always included; it's the starting point. */
export function findConnectedFromSeed(
  seedTri: number,
  adjacency: AdjacencyGraph,
  maxSeedDeviationCos: number,
): Set<number> {
  const { neighbors, normals } = adjacency;
  const result = new Set<number>();
  if (seedTri < 0 || seedTri >= neighbors.length) return result;

  const snx = normals[seedTri * 3];
  const sny = normals[seedTri * 3 + 1];
  const snz = normals[seedTri * 3 + 2];

  const queue = [seedTri];
  result.add(seedTri);

  while (queue.length > 0) {
    const current = queue.pop()!;
    const adj = neighbors[current];
    for (let i = 0; i < adj.length; i++) {
      const neighbor = adj[i];
      if (result.has(neighbor)) continue;

      const nx = normals[neighbor * 3];
      const ny = normals[neighbor * 3 + 1];
      const nz = normals[neighbor * 3 + 2];

      const dot = snx * nx + sny * ny + snz * nz;
      if (dot >= maxSeedDeviationCos) {
        result.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return result;
}

/** Get the normal of a specific triangle. */
export function getTriangleNormal(triIndex: number, adjacency: AdjacencyGraph): [number, number, number] {
  return [
    adjacency.normals[triIndex * 3],
    adjacency.normals[triIndex * 3 + 1],
    adjacency.normals[triIndex * 3 + 2],
  ];
}

/** Get the centroid of a specific triangle. */
export function getTriangleCentroid(triIndex: number, mesh: MeshData): [number, number, number] {
  const { triVerts, vertProperties, numProp } = mesh;
  const v0 = triVerts[triIndex * 3];
  const v1 = triVerts[triIndex * 3 + 1];
  const v2 = triVerts[triIndex * 3 + 2];

  return [
    (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3,
    (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3,
    (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3,
  ];
}

/** Find the triangle whose surface point is closest to a given world point.
 *  Returns the triangle index, the closest point on that triangle, the
 *  triangle's normal, and the distance from the input point. Returns -1 for
 *  the index when the mesh has no triangles. */
export function findNearestTriangle(
  point: [number, number, number],
  mesh: MeshData,
  adjacency: AdjacencyGraph,
): { triIndex: number; closest: [number, number, number]; normal: [number, number, number]; distance: number } {
  const { triVerts, vertProperties, numProp, numTri } = mesh;

  let bestDist = Infinity;
  let bestTri = -1;
  let bestPoint: [number, number, number] = [0, 0, 0];

  const px = point[0], py = point[1], pz = point[2];

  for (let t = 0; t < numTri; t++) {
    const v0i = triVerts[t * 3];
    const v1i = triVerts[t * 3 + 1];
    const v2i = triVerts[t * 3 + 2];

    const ax = vertProperties[v0i * numProp];
    const ay = vertProperties[v0i * numProp + 1];
    const az = vertProperties[v0i * numProp + 2];
    const bx = vertProperties[v1i * numProp];
    const by = vertProperties[v1i * numProp + 1];
    const bz = vertProperties[v1i * numProp + 2];
    const cx = vertProperties[v2i * numProp];
    const cy = vertProperties[v2i * numProp + 1];
    const cz = vertProperties[v2i * numProp + 2];

    const cp = closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
    const dx = cp[0] - px, dy = cp[1] - py, dz = cp[2] - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestTri = t;
      bestPoint = cp;
    }
  }

  const normal: [number, number, number] = bestTri >= 0
    ? [adjacency.normals[bestTri * 3], adjacency.normals[bestTri * 3 + 1], adjacency.normals[bestTri * 3 + 2]]
    : [0, 0, 0];

  return { triIndex: bestTri, closest: bestPoint, normal, distance: bestDist };
}

/** Closest point on triangle ABC to point P (Ericson, Real-Time Collision
 *  Detection, ch. 5.1.5). Inlined for hot-loop use. */
export function closestPointOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + v * abx, ay + v * aby, az + v * abz];
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + w * acx, ay + w * acy, az + w * acz];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [
    ax + abx * v + acx * w,
    ay + aby * v + acy * w,
    az + abz * v + acz * w,
  ];
}

/** Resolve a spatial seed descriptor back to a triangle index by raycasting
 *  from seedPoint along -seedNormal into the mesh. Returns the first triangle
 *  whose normal matches within tolerance, or -1 if none found. */
export function resolveSeed(
  seedPoint: [number, number, number],
  seedNormal: [number, number, number],
  mesh: MeshData,
  adjacency: AdjacencyGraph,
  normalTolerance = 0.9995,
): number {
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const epsilon = 0.01;

  // Ray origin: slightly above the surface along the normal
  const ox = seedPoint[0] + seedNormal[0] * epsilon;
  const oy = seedPoint[1] + seedNormal[1] * epsilon;
  const oz = seedPoint[2] + seedNormal[2] * epsilon;

  // Ray direction: into the surface
  const dx = -seedNormal[0];
  const dy = -seedNormal[1];
  const dz = -seedNormal[2];

  let bestT = Infinity;
  let bestTri = -1;

  for (let t = 0; t < numTri; t++) {
    const v0i = triVerts[t * 3];
    const v1i = triVerts[t * 3 + 1];
    const v2i = triVerts[t * 3 + 2];

    const p0x = vertProperties[v0i * numProp];
    const p0y = vertProperties[v0i * numProp + 1];
    const p0z = vertProperties[v0i * numProp + 2];
    const p1x = vertProperties[v1i * numProp];
    const p1y = vertProperties[v1i * numProp + 1];
    const p1z = vertProperties[v1i * numProp + 2];
    const p2x = vertProperties[v2i * numProp];
    const p2y = vertProperties[v2i * numProp + 1];
    const p2z = vertProperties[v2i * numProp + 2];

    // Möller–Trumbore intersection
    const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
    const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;

    const a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -1e-8 && a < 1e-8) continue;

    const f = 1 / a;
    const sx = ox - p0x, sy = oy - p0y, sz = oz - p0z;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;

    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;

    const tHit = f * (e2x * qx + e2y * qy + e2z * qz);
    if (tHit > 0 && tHit < bestT) {
      // Check normal tolerance
      const nx = adjacency.normals[t * 3];
      const ny = adjacency.normals[t * 3 + 1];
      const nz = adjacency.normals[t * 3 + 2];
      const dot = seedNormal[0] * nx + seedNormal[1] * ny + seedNormal[2] * nz;
      if (dot >= normalTolerance) {
        bestT = tHit;
        bestTri = t;
      }
    }
  }

  return bestTri;
}
