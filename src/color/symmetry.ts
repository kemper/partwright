// Bilateral symmetry — axis-aligned mirror-plane detection, mirror-sibling
// island pairing, and mirror-transfer of a painted triangle set.
//
// Two needs drive this: (1) an AI agent painting an imported bilateral
// character STL wants "mirror this paint to the other side" without manually
// locating the far side, and (2) a 25-piece articulated figure kit laid flat
// on a print plate wants its left/right mesh islands (from `meshIslands` in
// `./meshIslands.ts`) paired up so identifying one part identifies its twin.
//
// Only axis-aligned candidate planes (through the whole-mesh bbox centre) are
// considered — that covers the overwhelming majority of printed figures and
// kits, which are modelled/laid out axis-aligned, and keeps the search to
// three cheap candidates instead of an open-ended plane search.
//
// Every function here builds its own uniform spatial hash of triangle
// centroids (cell size ≈ bboxDiag/64) and reuses it for every query made
// during that call — the mesh can be 500k triangles, so nearest-centroid
// lookups must be O(1)-ish, not the O(n²) a naive scan would cost. Lookups
// search the query point's cell plus its 26 neighbours first, then expand
// outward ring by ring (capped) before giving up and treating it as "no
// match" — which is the correct outcome for paint near the plane's edge or a
// genuinely asymmetric region.

import type { MeshData } from '../geometry/types';
import { meshIslands } from './meshIslands';

export interface SymmetryPlane {
  /** Plane through `point` with unit `normal`. Axis-aligned candidates only for now. */
  axis: 'x' | 'y' | 'z';
  point: [number, number, number];
  normal: [number, number, number];
  /** Mean reflected-nearest-neighbour residual, normalized by mesh bbox diagonal. Lower = more symmetric. */
  residual: number;
  /** 0..1 quality score: max(0, 1 - residual / 0.02) clamped — i.e. residual 0 → 1.0, residual ≥2% of bbox diag → 0. */
  score: number;
}

// --- Tuning constants -------------------------------------------------
// These are algorithmic thresholds intrinsic to the symmetry heuristic
// (mirrored on the sibling `meshIslands.ts`'s own hardcoded thresholds, e.g.
// its `0.02` modelUpAxis asymmetry cutoff) rather than user-tunable app
// settings, so they live here rather than in `appConfig`.

/** Default number of stride-sampled triangle centroids `detectSymmetryPlane`
 *  scores per candidate axis. */
const DEFAULT_SAMPLE_COUNT = 2000;

/** Below this score, a candidate plane isn't meaningfully symmetric. */
const SYMMETRY_SCORE_THRESHOLD = 0.3;

/** Residual (as a fraction of bbox diagonal) at which score hits 0. Residual
 *  0 → score 1.0; residual ≥ this → score 0 (clamped). */
const RESIDUAL_SCORE_NORM = 0.02;

/** Island bbox-center reflect tolerance for `mirrorIslandPairs`, as a
 *  fraction of the mesh bbox diagonal. */
const MIRROR_CENTER_TOLERANCE_FRACTION = 0.02;

/** Island triangleCount agreement tolerance for `mirrorIslandPairs`, as a
 *  fraction of the larger of the two counts. */
const TRIANGLE_COUNT_TOLERANCE_FRACTION = 0.02;

/** Default `mirrorTriangleSet` snap-distance cap, as a fraction of the mesh
 *  bbox diagonal — rejects a reflected point that lands too far from any
 *  real triangle (paint near the plane's edge). */
const DEFAULT_MAX_SNAP_DISTANCE_FRACTION = 0.01;

/** Spatial hash cell size, as `bboxDiag / this` — fine enough that a
 *  genuinely mirrored centroid almost always lands in the same or an
 *  adjacent cell as its sibling, so the ring search below converges fast. */
const HASH_CELLS_PER_DIAGONAL = 64;

/** Cap on how many rings the nearest-neighbour search expands outward before
 *  giving up and reporting "no match". */
const MAX_RING_EXPANSION = 6;

// --- Geometry helpers ---------------------------------------------------

function meshBBox(mesh: MeshData): { min: [number, number, number]; max: [number, number, number] } {
  const { vertProperties, numVert, numProp } = mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < numVert; v++) {
    const x = vertProperties[v * numProp];
    const y = vertProperties[v * numProp + 1];
    const z = vertProperties[v * numProp + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function bboxDiagonal(bbox: { min: [number, number, number]; max: [number, number, number] }): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function triangleCentroid(mesh: MeshData, t: number): [number, number, number] {
  const { triVerts, vertProperties, numProp } = mesh;
  const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
  const x = (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3;
  const y = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3;
  const z = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3;
  return [x, y, z];
}

function allTriangleCentroids(mesh: MeshData): [number, number, number][] {
  const { numTri } = mesh;
  const out: [number, number, number][] = new Array(numTri);
  for (let t = 0; t < numTri; t++) out[t] = triangleCentroid(mesh, t);
  return out;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// --- Uniform spatial hash over triangle centroids -----------------------
//
// Built once per exported call and reused for every nearest-neighbour query
// made during that call — O(n) to build, ~O(1) average per query.

interface CentroidHash {
  cellSize: number;
  buckets: Map<string, number[]>;
  points: Float64Array; // flat xyz, length = 3 * centroids.length
}

function cellKeyOf(x: number, y: number, z: number, cellSize: number): string {
  const ix = Math.floor(x / cellSize);
  const iy = Math.floor(y / cellSize);
  const iz = Math.floor(z / cellSize);
  return `${ix},${iy},${iz}`;
}

function buildCentroidHash(centroids: [number, number, number][], cellSize: number): CentroidHash {
  const n = centroids.length;
  const points = new Float64Array(n * 3);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const [x, y, z] = centroids[i];
    points[i * 3] = x; points[i * 3 + 1] = y; points[i * 3 + 2] = z;
    const key = cellKeyOf(x, y, z, cellSize);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(i);
  }
  return { cellSize, buckets, points };
}

/** Nearest indexed centroid to `query` — searches the query's cell plus its
 *  26 neighbours first, then expands outward one ring at a time (capped at
 *  `MAX_RING_EXPANSION`) until a candidate turns up. Returns null when
 *  nothing is found within the cap — the caller treats that as "no match"
 *  rather than snapping to something arbitrarily far away. */
function findNearest(hash: CentroidHash, query: [number, number, number]): { id: number; dist: number } | null {
  const { cellSize, buckets, points } = hash;
  const [qx, qy, qz] = query;
  const cix = Math.floor(qx / cellSize);
  const ciy = Math.floor(qy / cellSize);
  const ciz = Math.floor(qz / cellSize);

  for (let radius = 1; radius <= MAX_RING_EXPANSION; radius++) {
    let bestId = -1;
    let bestD2 = Infinity;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const bucket = buckets.get(`${cix + dx},${ciy + dy},${ciz + dz}`);
          if (!bucket) continue;
          for (const id of bucket) {
            const px = points[id * 3], py = points[id * 3 + 1], pz = points[id * 3 + 2];
            const ddx = px - qx, ddy = py - qy, ddz = pz - qz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < bestD2) { bestD2 = d2; bestId = id; }
          }
        }
      }
    }
    if (bestId >= 0) return { id: bestId, dist: Math.sqrt(bestD2) };
  }
  return null;
}

// --- detectSymmetryPlane -------------------------------------------------

/** Detect the best axis-aligned bilateral symmetry plane of the whole mesh.
 *  Try the three planes through the mesh bbox center; score each by
 *  reflecting a sample of triangle centroids and measuring nearest-centroid
 *  distance on the far side (uniform spatial hash for O(1) lookups — the
 *  mesh can be 500k triangles, no O(n²)). Returns null when the best score
 *  is < 0.3 (not meaningfully symmetric). */
export function detectSymmetryPlane(mesh: MeshData, opts?: { sampleCount?: number }): SymmetryPlane | null {
  const { numTri } = mesh;
  if (numTri === 0) return null;

  const bbox = meshBBox(mesh);
  const diag = bboxDiagonal(bbox);
  if (!(diag > 0)) return null;

  const center: [number, number, number] = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];

  // ONE spatial hash of every triangle centroid, reused for all three axis
  // candidates and every sample within each.
  const centroids = allTriangleCentroids(mesh);
  const cellSize = diag / HASH_CELLS_PER_DIAGONAL || 1;
  const hash = buildCentroidHash(centroids, cellSize);

  const sampleCount = Math.max(1, opts?.sampleCount ?? DEFAULT_SAMPLE_COUNT);
  const stride = Math.max(1, Math.floor(numTri / sampleCount));
  const sampleIds: number[] = [];
  for (let t = 0; t < numTri && sampleIds.length < sampleCount; t += stride) sampleIds.push(t);

  const candidates: Array<{ axis: 'x' | 'y' | 'z'; normal: [number, number, number] }> = [
    { axis: 'x', normal: [1, 0, 0] },
    { axis: 'y', normal: [0, 1, 0] },
    { axis: 'z', normal: [0, 0, 1] },
  ];

  let best: SymmetryPlane | null = null;
  for (const { axis, normal } of candidates) {
    const plane: SymmetryPlane = { axis, point: center, normal, residual: 0, score: 0 };
    let sumDist = 0;
    let matched = 0;
    for (const t of sampleIds) {
      const reflected = reflectPoint(centroids[t], plane);
      const nearest = findNearest(hash, reflected);
      if (!nearest) continue;
      sumDist += nearest.dist;
      matched++;
    }
    if (matched === 0) continue;
    const residual = (sumDist / matched) / diag;
    const score = Math.max(0, 1 - residual / RESIDUAL_SCORE_NORM);
    plane.residual = residual;
    plane.score = score;
    if (!best || score > best.score) best = plane;
  }

  if (!best || best.score < SYMMETRY_SCORE_THRESHOLD) return null;
  return best;
}

// --- mirrorIslandPairs ----------------------------------------------------

/** Pair mirror-sibling islands under `plane`: two islands match when their
 *  triangleCounts agree within 2% AND each one's bbox center reflects to
 *  within (2% of mesh bbox diagonal) of the other's center. Self-symmetric
 *  islands (center on the plane) map to their own index. Returns
 *  mirrorOf[i] = j (or null when unpaired). */
export function mirrorIslandPairs(mesh: MeshData, plane: SymmetryPlane): (number | null)[] {
  const { islands } = meshIslands(mesh);
  const diag = bboxDiagonal(meshBBox(mesh));
  const centerTolerance = diag * MIRROR_CENTER_TOLERANCE_FRACTION;

  const result: (number | null)[] = new Array(islands.length).fill(null);

  for (let i = 0; i < islands.length; i++) {
    if (result[i] !== null) continue; // already paired as an earlier island's match
    const a = islands[i];
    const reflectedCenter = reflectPoint(a.center, plane);

    if (distance(reflectedCenter, a.center) <= centerTolerance) {
      result[i] = i; // straddles the plane — its own mirror
      continue;
    }

    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < islands.length; j++) {
      if (j === i || result[j] !== null) continue;
      const b = islands[j];
      const maxCount = Math.max(a.triangleCount, b.triangleCount);
      const countDiff = maxCount > 0 ? Math.abs(a.triangleCount - b.triangleCount) / maxCount : 0;
      if (countDiff > TRIANGLE_COUNT_TOLERANCE_FRACTION) continue;
      const d = distance(reflectedCenter, b.center);
      if (d <= centerTolerance && d < bestDist) { bestDist = d; bestJ = j; }
    }
    if (bestJ >= 0) {
      result[i] = bestJ;
      result[bestJ] = i;
    }
  }

  return result;
}

// --- reflectPoint / reflectVector -----------------------------------------

export function reflectPoint(p: [number, number, number], plane: SymmetryPlane): [number, number, number] {
  const { point, normal } = plane;
  const dx = p[0] - point[0], dy = p[1] - point[1], dz = p[2] - point[2];
  const d = dx * normal[0] + dy * normal[1] + dz * normal[2];
  return [
    p[0] - 2 * d * normal[0],
    p[1] - 2 * d * normal[1],
    p[2] - 2 * d * normal[2],
  ];
}

export function reflectVector(v: [number, number, number], plane: SymmetryPlane): [number, number, number] {
  const { normal } = plane;
  const d = v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2];
  return [
    v[0] - 2 * d * normal[0],
    v[1] - 2 * d * normal[1],
    v[2] - 2 * d * normal[2],
  ];
}

// --- mirrorTriangleSet -----------------------------------------------------

/** Mirror a triangle set across the plane: reflect each source triangle's
 *  centroid, find the nearest triangle centroid on the target side (spatial
 *  hash), include it. `maxSnapDistance` (default 1% of bbox diag) rejects
 *  snaps that land too far (paint near the plane edge). Returns the target
 *  triangle set + stats. */
export function mirrorTriangleSet(
  triangles: Set<number>,
  mesh: MeshData,
  plane: SymmetryPlane,
  opts?: { maxSnapDistance?: number },
): { triangles: Set<number>; snapped: number; rejected: number; meanSnapError: number } {
  const diag = bboxDiagonal(meshBBox(mesh));
  const maxSnapDistance = opts?.maxSnapDistance ?? diag * DEFAULT_MAX_SNAP_DISTANCE_FRACTION;

  // ONE spatial hash of every triangle centroid, reused for every source
  // triangle in `triangles`.
  const centroids = allTriangleCentroids(mesh);
  const cellSize = diag / HASH_CELLS_PER_DIAGONAL || 1;
  const hash = buildCentroidHash(centroids, cellSize);

  const out = new Set<number>();
  let snapped = 0;
  let rejected = 0;
  let errSum = 0;

  for (const t of triangles) {
    const centroid = centroids[t] ?? triangleCentroid(mesh, t);
    const reflected = reflectPoint(centroid, plane);
    const nearest = findNearest(hash, reflected);
    if (!nearest || nearest.dist > maxSnapDistance) {
      rejected++;
      continue;
    }
    out.add(nearest.id);
    snapped++;
    errSum += nearest.dist;
  }

  const meanSnapError = snapped > 0 ? errSum / snapped : 0;
  return { triangles: out, snapped, rejected, meanSnapError };
}
