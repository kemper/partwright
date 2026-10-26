// Triangle adjacency and coplanar region finding

import type { MeshData } from '../geometry/types';

export interface AdjacencyGraph {
  /** Adjacent triangles as CSR: the neighbours of triangle t are
   *  `nbFlat[nbStart[t] .. nbStart[t + 1])`. Flat on
   *  purpose — one typed-array view per triangle cost ~2 s to allocate at
   *  3.7M triangles, more than building the graph itself. */
  nbStart: Uint32Array;
  nbFlat: Uint32Array;
  /** Triangle normals — 3 floats per triangle (nx, ny, nz). */
  normals: Float32Array;
  /** Triangle centroids — 3 floats per triangle (cx, cy, cz). Used by the
   *  brush tool's radius expansion (sphere query against centroids). */
  centroids: Float32Array;
}

/** Build a triangle adjacency graph from mesh data.
 *  O(Σ valence²) with a hashed vertex lookup — effectively O(numTri) for the
 *  bounded-valence meshes we deal with. */
export function buildAdjacency(mesh: MeshData): AdjacencyGraph {
  const { triVerts, numTri, numVert, vertProperties, numProp } = mesh;

  // Canonicalise vertices by exact position, then connect triangles that share a
  // *vertex* (corner), not just a full edge. Two reasons:
  //
  //  1. **Coincident-but-split vertices.** A render mesh can carry per-triangle
  //     vertex copies at the same position; matching by raw index would miss the
  //     shared corner. Welding by position fixes that.
  //  2. **T-junctions.** The brush's adaptive subdivision leaves hanging nodes —
  //     one triangle's edge is split into two while the neighbour's stays whole,
  //     so the full edge (vertex pair) no longer matches and edge-only adjacency
  //     shatters the mesh into tiny islands (a bucket flood-fill grabs ~6
  //     triangles instead of the whole region). The split edge's two *endpoints*
  //     are still shared corners, so corner adjacency keeps both sides connected.
  //
  // The flood-fill callers (`findColorRegion`, `findCoplanarRegion`,
  // `findConnectedFromSeed`) gate every step by color or normal, so the looser
  // corner adjacency can't over-select beyond what those thresholds allow.
  const vertCanon = canonicalVertexIds(vertProperties, numVert, numProp);
  let numCanon = 0;
  for (let v = 0; v < numVert; v++) if (vertCanon[v] >= numCanon) numCanon = vertCanon[v] + 1;

  // Vertex (canonical position) → triangles touching it, as CSR arrays. Typed
  // arrays instead of a Map of number[] keep this to a few allocations on a
  // 700k-triangle mesh, where the old Map/Set version took several seconds of
  // main-thread time (paint mode pre-warms this on every mesh change).
  const vtStart = new Uint32Array(numCanon + 1);
  for (let i = 0; i < numTri * 3; i++) vtStart[vertCanon[triVerts[i]] + 1]++;
  for (let c = 0; c < numCanon; c++) vtStart[c + 1] += vtStart[c];
  const vtTris = new Uint32Array(numTri * 3);
  const cursor = vtStart.slice(0, numCanon);
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) vtTris[cursor[vertCanon[triVerts[t * 3 + k]]]++] = t;
  }

  // Every pair of triangles sharing a vertex is adjacent. Two passes over each
  // triangle's corner fans (count, then fill) with a stamp array for dedupe,
  // so all neighbour lists share one flat buffer.
  const stamp = new Int32Array(numTri).fill(-1);
  const nbStart = new Uint32Array(numTri + 1);
  for (let t = 0; t < numTri; t++) {
    let count = 0;
    stamp[t] = t;
    for (let k = 0; k < 3; k++) {
      const c = vertCanon[triVerts[t * 3 + k]];
      for (let j = vtStart[c]; j < vtStart[c + 1]; j++) {
        const u = vtTris[j];
        if (stamp[u] !== t) { stamp[u] = t; count++; }
      }
    }
    nbStart[t + 1] = nbStart[t] + count;
  }
  const nbFlat = new Uint32Array(nbStart[numTri]);
  stamp.fill(-1);
  for (let t = 0; t < numTri; t++) {
    let w = nbStart[t];
    stamp[t] = t;
    for (let k = 0; k < 3; k++) {
      const c = vertCanon[triVerts[t * 3 + k]];
      for (let j = vtStart[c]; j < vtStart[c + 1]; j++) {
        const u = vtTris[j];
        if (stamp[u] !== t) { stamp[u] = t; nbFlat[w++] = u; }
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
    nbStart,
    nbFlat,
    normals,
    centroids,
  };
}

/** Map each vertex to a dense id shared by every vertex at the exact same
 *  position (same float values; +0/-0 and all NaNs count as equal). Open-addressing
 *  hash over the coordinate bit patterns — no string keys. */
function canonicalVertexIds(vertProperties: Float32Array, numVert: number, numProp: number): Int32Array {
  const bits = new Uint32Array(vertProperties.buffer, vertProperties.byteOffset, vertProperties.length);
  const key = (v: number, a: number): number => {
    const b = bits[v * numProp + a];
    if (b === 0x80000000) return 0; // -0 → +0
    if ((b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0) return 0x7fc00000; // any NaN → one NaN
    return b;
  };
  let size = 1;
  while (size < numVert * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1); // slot → representative vertex
  const canonOfRep = new Int32Array(numVert);
  const out = new Int32Array(numVert);
  let next = 0;
  for (let v = 0; v < numVert; v++) {
    const x = key(v, 0), y = key(v, 1), z = key(v, 2);
    // Mix every bit before masking: grid-aligned coordinates (voxels,
    // integer-sized CAD) have all-zero low mantissa bits, so a hash that only
    // multiplies would put them in a handful of slots and probe quadratically.
    let h = Math.imul(x, 0x9e3779b1);
    h = Math.imul(h ^ y ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ z ^ (h >>> 13), 0xc2b2ae35);
    h = (h ^ (h >>> 16)) & mask;
    for (;;) {
      const r = table[h];
      if (r === -1) {
        table[h] = v;
        canonOfRep[v] = next;
        out[v] = next++;
        break;
      }
      if (key(r, 0) === x && key(r, 1) === y && key(r, 2) === z) {
        out[v] = canonOfRep[r];
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return out;
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
  const { nbStart, nbFlat, normals } = adjacency;
  const result = new Set<number>();

  const queue = [seedTri];
  result.add(seedTri);

  while (queue.length > 0) {
    const current = queue.pop()!;
    const cnx = normals[current * 3];
    const cny = normals[current * 3 + 1];
    const cnz = normals[current * 3 + 2];

    for (let i = nbStart[current]; i < nbStart[current + 1]; i++) {
      const neighbor = nbFlat[i];
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

/** Restrict a candidate triangle set to the part connected to `seedTri`
 *  without crossing an edge sharper than the wrap tolerance — the
 *  adjacent-pair (accumulating) dihedral gate of `findCoplanarRegion`, but
 *  confined to `candidates`. Used to apply the brush's wrap tolerance to the
 *  legacy screen-projection footprint (which is a spatial set with no surface
 *  gate of its own), so "don't wrap past sharp edges" works with smooth edges
 *  off exactly as it does on (where `buildGeodesicField` gates the flood fill).
 *
 *  `normalTolerance` is the cosine of the max bend angle (as in
 *  `findCoplanarRegion`): -1 (cos 180°) = no gate, returns `candidates`
 *  unchanged. The walk only steps into triangles already in `candidates`, so
 *  the result is always a subset. When the seed isn't in `candidates` the set
 *  is returned untouched (nothing to anchor the walk). */
export function gateRegionByBend(
  candidates: Set<number>,
  seedTri: number,
  adjacency: AdjacencyGraph,
  normalTolerance: number,
): Set<number> {
  if (normalTolerance <= -1 || !candidates.has(seedTri)) return candidates;
  const { nbStart, nbFlat, normals } = adjacency;
  const result = new Set<number>([seedTri]);
  const stack = [seedTri];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const cnx = normals[current * 3];
    const cny = normals[current * 3 + 1];
    const cnz = normals[current * 3 + 2];
    for (let i = nbStart[current]; i < nbStart[current + 1]; i++) {
      const neighbor = nbFlat[i];
      if (result.has(neighbor) || !candidates.has(neighbor)) continue;
      const dot = cnx * normals[neighbor * 3] + cny * normals[neighbor * 3 + 1] + cnz * normals[neighbor * 3 + 2];
      if (dot < normalTolerance) continue;
      result.add(neighbor);
      stack.push(neighbor);
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
  /** Optional spatial clamp — the BFS only walks into triangles whose
   *  centroid passes `centroidPredicate`. Use for "flood-fill the dome but
   *  do NOT walk down into the collar at z=13" cases the seed-normal test
   *  can't catch on its own (a fused-solid mesh is one connected component
   *  even when its features used to be separate inputs). */
  centroidPredicate?: (cx: number, cy: number, cz: number) => boolean,
  /** Optional color gate — each candidate must have a color within
   *  `maxColorDist` (0–1, Euclidean distance normalized by sqrt(3)×255)
   *  of the seed triangle's color. Ignored when triColors is absent. */
  colorOpts?: { triColors: Uint8Array; maxColorDist: number },
): Set<number> {
  const { nbStart, nbFlat, normals, centroids } = adjacency;
  const result = new Set<number>();
  if (seedTri < 0 || seedTri >= nbStart.length - 1) return result;

  // The seed itself must satisfy the clamp — otherwise we're already
  // outside the intended region and the walk is meaningless.
  if (centroidPredicate) {
    const cx = centroids[seedTri * 3];
    const cy = centroids[seedTri * 3 + 1];
    const cz = centroids[seedTri * 3 + 2];
    if (!centroidPredicate(cx, cy, cz)) return result;
  }

  const snx = normals[seedTri * 3];
  const sny = normals[seedTri * 3 + 1];
  const snz = normals[seedTri * 3 + 2];

  // Pre-extract seed color (fixed reference, same as seed-normal approach).
  const seedR = colorOpts ? colorOpts.triColors[seedTri * 3]     : 0;
  const seedG = colorOpts ? colorOpts.triColors[seedTri * 3 + 1] : 0;
  const seedB = colorOpts ? colorOpts.triColors[seedTri * 3 + 2] : 0;
  const INV_SQRT3_255 = 1 / (1.7320508 * 255);

  const queue = [seedTri];
  result.add(seedTri);

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (let i = nbStart[current]; i < nbStart[current + 1]; i++) {
      const neighbor = nbFlat[i];
      if (result.has(neighbor)) continue;

      const nx = normals[neighbor * 3];
      const ny = normals[neighbor * 3 + 1];
      const nz = normals[neighbor * 3 + 2];

      const dot = snx * nx + sny * ny + snz * nz;
      if (dot < maxSeedDeviationCos) continue;

      if (centroidPredicate) {
        const cx = centroids[neighbor * 3];
        const cy = centroids[neighbor * 3 + 1];
        const cz = centroids[neighbor * 3 + 2];
        if (!centroidPredicate(cx, cy, cz)) continue;
      }

      if (colorOpts) {
        const dr = colorOpts.triColors[neighbor * 3]     - seedR;
        const dg = colorOpts.triColors[neighbor * 3 + 1] - seedG;
        const db = colorOpts.triColors[neighbor * 3 + 2] - seedB;
        const colorDist = Math.sqrt(dr * dr + dg * dg + db * db) * INV_SQRT3_255;
        if (colorDist > colorOpts.maxColorDist) continue;
      }

      result.add(neighbor);
      queue.push(neighbor);
    }
  }

  return result;
}

/** BFS from a seed triangle, accepting each neighbor whose color is within
 *  `colorTolerance` of the SEED triangle's color (magic-wand semantics — the
 *  threshold is anchored to the seed, so it doesn't accumulate over the surface).
 *
 *  `triColors` is a Uint8Array of 3 bytes (R, G, B, 0–255) per triangle as
 *  produced by `buildTriColors`. Pass null for an unpainted mesh — the entire
 *  connected component is returned (all triangles look the same).
 *
 *  `colorTolerance` is in [0, 1] — the maximum normalised Euclidean RGB distance
 *  from the seed color. 0 = exact match only; 1 = accept any color (whole
 *  connected component). Default 0.05. */
export function findColorRegion(
  seedTri: number,
  adjacency: AdjacencyGraph,
  triColors: Uint8Array | null,
  colorTolerance = 0.05,
  /** Optional anchor color (R,G,B 0–255) the flood matches against, instead of
   *  the seed triangle's own color in `triColors`. Lets a re-resolve follow the
   *  *original* matched color even after the seed triangle has been recolored. */
  seedColorOverride?: readonly [number, number, number],
): Set<number> {
  const { nbStart, nbFlat } = adjacency;
  const result = new Set<number>();

  if (colorTolerance >= 1 || !triColors) {
    // Fast path: accept the entire connected component
    const queue = [seedTri];
    result.add(seedTri);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (let i = nbStart[current]; i < nbStart[current + 1]; i++) {
        const nb = nbFlat[i];
        if (!result.has(nb)) { result.add(nb); queue.push(nb); }
      }
    }
    return result;
  }

  const sr = seedColorOverride ? seedColorOverride[0] : triColors[seedTri * 3];
  const sg = seedColorOverride ? seedColorOverride[1] : triColors[seedTri * 3 + 1];
  const sb = seedColorOverride ? seedColorOverride[2] : triColors[seedTri * 3 + 2];

  // Max squared distance in normalised [0,1]³ space is 3.
  const maxDistSq = colorTolerance * colorTolerance * 3;

  const queue = [seedTri];
  result.add(seedTri);

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (let i = nbStart[current]; i < nbStart[current + 1]; i++) {
      const nb = nbFlat[i];
      if (result.has(nb)) continue;

      const dr = (triColors[nb * 3]     - sr) / 255;
      const dg = (triColors[nb * 3 + 1] - sg) / 255;
      const db = (triColors[nb * 3 + 2] - sb) / 255;
      if (dr * dr + dg * dg + db * db <= maxDistSq) {
        result.add(nb);
        queue.push(nb);
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
