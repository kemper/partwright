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
  /** Sum of triangle areas in this island — a size proxy that isn't fooled by
   *  fine-tessellation regions (a highly-subdivided flat disc has huge
   *  triangleCount but small surfaceArea; a coarse but large shell has small
   *  triangleCount but big surfaceArea). Ranks islands by "visible bulk". */
  surfaceArea: number;
  /** Axis of greatest bbox extent — `'x'`/`'y'`/`'z'`. Print-in-place kits
   *  laid flat still let an agent infer "this is a leg" (long along its
   *  principal axis) vs "this is a puck" (aspect ratio near 1). */
  principalAxis: 'x' | 'y' | 'z';
  /** Same as `principalAxis` but as a unit 3-vector so callers don't have to
   *  translate. `'x'` → `[1,0,0]`; `'y'` → `[0,1,0]`; `'z'` → `[0,0,1]`. Also
   *  the axis stripes/slabs should flow along. */
  principalAxisVector: [number, number, number];
  /** Length along the principal axis. */
  principalExtent: number;
  /** Normalized bbox extents (max = 1) in the order [x, y, z]. `[1, 0.1, 0.1]`
   *  = stick; `[1, 1, 0.05]` = shell / thin disc; `[1, 1, 1]` = blobby. */
  aspectRatio: [number, number, number];
  /** Fraction of the island's surface area facing each ±axis hemisphere.
   *  Sums to ~1 across the six buckets. Distinguishes "shell whose normals
   *  point mostly +Y" from "flat disc whose normals bunch on one axis". */
  normalHistogram: {
    xPos: number; xNeg: number;
    yPos: number; yNeg: number;
    zPos: number; zNeg: number;
  };
}

export interface MeshIslandsResult {
  /** Per-triangle island id, length = mesh.numTri. */
  triIslands: Uint32Array;
  /** Per-island metadata. */
  islands: MeshIsland[];
  /** Whole-mesh axis-hemisphere histogram (area-weighted), aggregated across
   *  every island. */
  meshNormalHistogram: {
    xPos: number; xNeg: number;
    yPos: number; yNeg: number;
    zPos: number; zNeg: number;
  };
  /** Best-guess "which way is up" for the entire mesh, derived from
   *  `meshNormalHistogram`: the axis with the largest asymmetry between its
   *  + and − hemispheres — the reasoning being that a printed figure has more
   *  top-facing area than bottom-facing area (canopy > underside). Also
   *  weighted by whole-mesh bbox extents so a flat-on-plate figure (bbox
   *  tall in Y) prefers Y over Z when the histogram is close. `null` when
   *  the mesh is empty or all axes are within 5% of each other. */
  modelUpAxis: { axis: 'x' | 'y' | 'z'; sign: '+' | '-'; confidence: number } | null;
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
  const emptyHistogram = { xPos: 0, xNeg: 0, yPos: 0, yNeg: 0, zPos: 0, zNeg: 0 };
  if (numTri === 0) return { triIslands, islands: [], meshNormalHistogram: emptyHistogram, modelUpAxis: null };

  // Sentinel: 0xFFFFFFFF = unvisited. (Real island ids start at 0 and we
  // won't ever hit 2^32-1 islands.)
  triIslands.fill(0xFFFFFFFF);

  const adjacency = buildAdjacency(mesh);
  const { neighbors, normals } = adjacency;
  const { triVerts, vertProperties, numProp } = mesh;

  const islands: MeshIsland[] = [];
  const stack: number[] = [];
  const meshHist = { xPos: 0, xNeg: 0, yPos: 0, yNeg: 0, zPos: 0, zNeg: 0 };
  let meshMinX = Infinity, meshMinY = Infinity, meshMinZ = Infinity;
  let meshMaxX = -Infinity, meshMaxY = -Infinity, meshMaxZ = -Infinity;

  for (let seed = 0; seed < numTri; seed++) {
    if (triIslands[seed] !== 0xFFFFFFFF) continue;
    const islandIdx = islands.length;
    triIslands[seed] = islandIdx;
    stack.push(seed);

    let triCount = 0;
    let surfaceArea = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const hist = { xPos: 0, xNeg: 0, yPos: 0, yNeg: 0, zPos: 0, zNeg: 0 };

    while (stack.length > 0) {
      const t = stack.pop()!;
      triCount++;
      const v0 = triVerts[t * 3];
      const v1 = triVerts[t * 3 + 1];
      const v2 = triVerts[t * 3 + 2];
      const ax = vertProperties[v0 * numProp];
      const ay = vertProperties[v0 * numProp + 1];
      const az = vertProperties[v0 * numProp + 2];
      const bx = vertProperties[v1 * numProp];
      const by = vertProperties[v1 * numProp + 1];
      const bz = vertProperties[v1 * numProp + 2];
      const cx = vertProperties[v2 * numProp];
      const cy = vertProperties[v2 * numProp + 1];
      const cz = vertProperties[v2 * numProp + 2];
      // bbox
      if (ax < minX) minX = ax; if (bx < minX) minX = bx; if (cx < minX) minX = cx;
      if (ay < minY) minY = ay; if (by < minY) minY = by; if (cy < minY) minY = cy;
      if (az < minZ) minZ = az; if (bz < minZ) minZ = bz; if (cz < minZ) minZ = cz;
      if (ax > maxX) maxX = ax; if (bx > maxX) maxX = bx; if (cx > maxX) maxX = cx;
      if (ay > maxY) maxY = ay; if (by > maxY) maxY = by; if (cy > maxY) maxY = cy;
      if (az > maxZ) maxZ = az; if (bz > maxZ) maxZ = bz; if (cz > maxZ) maxZ = cz;
      // triangle area from |AB × AC| / 2
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const crx = e1y * e2z - e1z * e2y;
      const cry = e1z * e2x - e1x * e2z;
      const crz = e1x * e2y - e1y * e2x;
      const area = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
      surfaceArea += area;
      // area-weighted normal-hemisphere accumulation for this triangle
      const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
      const ax_ = Math.abs(nx), ay_ = Math.abs(ny), az_ = Math.abs(nz);
      // Bucket into the DOMINANT hemisphere (biggest |axis|) — a normal has
      // components on all three axes but its geometric identity is the one
      // it points along most.
      if (ax_ >= ay_ && ax_ >= az_) { if (nx >= 0) hist.xPos += area; else hist.xNeg += area; }
      else if (ay_ >= ax_ && ay_ >= az_) { if (ny >= 0) hist.yPos += area; else hist.yNeg += area; }
      else { if (nz >= 0) hist.zPos += area; else hist.zNeg += area; }
      const ns = neighbors[t];
      for (let i = 0; i < ns.length; i++) {
        const nb = ns[i];
        if (triIslands[nb] === 0xFFFFFFFF) {
          triIslands[nb] = islandIdx;
          stack.push(nb);
        }
      }
    }

    // Roll this island into the whole-mesh accumulators.
    meshHist.xPos += hist.xPos; meshHist.xNeg += hist.xNeg;
    meshHist.yPos += hist.yPos; meshHist.yNeg += hist.yNeg;
    meshHist.zPos += hist.zPos; meshHist.zNeg += hist.zNeg;
    if (minX < meshMinX) meshMinX = minX;
    if (minY < meshMinY) meshMinY = minY;
    if (minZ < meshMinZ) meshMinZ = minZ;
    if (maxX > meshMaxX) meshMaxX = maxX;
    if (maxY > meshMaxY) meshMaxY = maxY;
    if (maxZ > meshMaxZ) meshMaxZ = maxZ;

    // Derived per-island metrics: principal axis, aspect ratio, normalised
    // histogram.
    const extents: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    const [ex, ey, ez] = extents;
    let principalAxis: 'x' | 'y' | 'z' = 'x';
    let principalExtent = ex;
    if (ey > principalExtent) { principalAxis = 'y'; principalExtent = ey; }
    if (ez > principalExtent) { principalAxis = 'z'; principalExtent = ez; }
    const maxExtent = principalExtent > 0 ? principalExtent : 1;
    const aspectRatio: [number, number, number] = [ex / maxExtent, ey / maxExtent, ez / maxExtent];
    const principalAxisVector: [number, number, number] =
      principalAxis === 'x' ? [1, 0, 0] :
      principalAxis === 'y' ? [0, 1, 0] :
                              [0, 0, 1];
    const histSum = hist.xPos + hist.xNeg + hist.yPos + hist.yNeg + hist.zPos + hist.zNeg;
    const normHist = histSum > 0
      ? {
          xPos: hist.xPos / histSum, xNeg: hist.xNeg / histSum,
          yPos: hist.yPos / histSum, yNeg: hist.yNeg / histSum,
          zPos: hist.zPos / histSum, zNeg: hist.zNeg / histSum,
        }
      : emptyHistogram;

    islands.push({
      index: islandIdx,
      triangleCount: triCount,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      surfaceArea,
      principalAxis,
      principalAxisVector,
      principalExtent,
      aspectRatio,
      normalHistogram: normHist,
    });
  }

  // Whole-mesh normalized histogram + up-axis guess.
  const meshHistSum = meshHist.xPos + meshHist.xNeg + meshHist.yPos + meshHist.yNeg + meshHist.zPos + meshHist.zNeg;
  const meshHistNorm = meshHistSum > 0
    ? {
        xPos: meshHist.xPos / meshHistSum, xNeg: meshHist.xNeg / meshHistSum,
        yPos: meshHist.yPos / meshHistSum, yNeg: meshHist.yNeg / meshHistSum,
        zPos: meshHist.zPos / meshHistSum, zNeg: meshHist.zNeg / meshHistSum,
      }
    : emptyHistogram;
  // Asymmetry per axis = |+ - −|. The axis with the biggest asymmetry is
  // where up-vs-down actually means something (a symmetric axis is a wash).
  const asymX = Math.abs(meshHistNorm.xPos - meshHistNorm.xNeg);
  const asymY = Math.abs(meshHistNorm.yPos - meshHistNorm.yNeg);
  const asymZ = Math.abs(meshHistNorm.zPos - meshHistNorm.zNeg);
  // Up-axis guess: the axis with the biggest ± hemisphere asymmetry, weighted
  // by bbox extent (a printed-flat figure has a tall Y bbox — head to toe —
  // so Y is a better "up" candidate than Z, which is thickness). When the
  // normal histogram is nearly symmetric (an articulated kit whose parts
  // point every which way — Pomni), we fall back to the tallest bbox axis
  // and mark confidence low so callers know it's an inference, not a
  // measurement. Loosened from 0.05 → 0.02 after the v3 Opus pass reported
  // `null` on the Pomni kit and both agents had to derive the up axis
  // themselves — bbox alone was already right for their case.
  const bboxExtents = { x: meshMaxX - meshMinX, y: meshMaxY - meshMinY, z: meshMaxZ - meshMinZ };
  const bboxMax = Math.max(bboxExtents.x, bboxExtents.y, bboxExtents.z) || 1;
  let upAxis: { axis: 'x' | 'y' | 'z'; sign: '+' | '-'; confidence: number } | null = null;
  const maxAsym = Math.max(asymX, asymY, asymZ);
  if (maxAsym > 0.02) {
    // Normal signal is meaningful — trust it (weighted by extent).
    const scored = [
      { axis: 'x' as const, sign: (meshHistNorm.xPos > meshHistNorm.xNeg ? '+' : '-') as '+' | '-', score: asymX * (bboxExtents.x / bboxMax) },
      { axis: 'y' as const, sign: (meshHistNorm.yPos > meshHistNorm.yNeg ? '+' : '-') as '+' | '-', score: asymY * (bboxExtents.y / bboxMax) },
      { axis: 'z' as const, sign: (meshHistNorm.zPos > meshHistNorm.zNeg ? '+' : '-') as '+' | '-', score: asymZ * (bboxExtents.z / bboxMax) },
    ];
    scored.sort((a, b) => b.score - a.score);
    upAxis = { axis: scored[0].axis, sign: scored[0].sign, confidence: scored[0].score };
  } else if (bboxMax > 0) {
    // Normals were a wash — fall back to "the mesh is tallest along this
    // axis." Sign is a guess; confidence flagged low so the caller can
    // combine with other signals if they care.
    const bboxScored = [
      { axis: 'x' as const, extent: bboxExtents.x },
      { axis: 'y' as const, extent: bboxExtents.y },
      { axis: 'z' as const, extent: bboxExtents.z },
    ];
    bboxScored.sort((a, b) => b.extent - a.extent);
    upAxis = { axis: bboxScored[0].axis, sign: '+', confidence: bboxScored[0].extent / bboxMax * 0.5 };
  }

  return { triIslands, islands, meshNormalHistogram: meshHistNorm, modelUpAxis: upAxis };
}

/** Collect every triangle id belonging to the given island. */
export function trianglesInIsland(triIslands: Uint32Array, islandIndex: number): Set<number> {
  const out = new Set<number>();
  for (let t = 0; t < triIslands.length; t++) {
    if (triIslands[t] === islandIndex) out.add(t);
  }
  return out;
}

/** Build a compact subset MeshData containing only the given triangles.
 *  Vertex data is remapped so `numVert` matches the referenced set and
 *  `triVerts` indexes 0..numVert-1. Used by `renderIsland` to hand the
 *  offscreen renderer just one island's triangles so the auto-framed
 *  camera hits ONLY that island — no other-island triangles in frame. */
export function subsetMesh(mesh: MeshData, triangles: Iterable<number>): MeshData {
  const { triVerts, vertProperties, numProp } = mesh;
  const oldToNewVert = new Map<number, number>();
  const newVertProperties: number[] = [];
  const newTriVerts: number[] = [];
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const oldV = triVerts[t * 3 + k];
      let newV = oldToNewVert.get(oldV);
      if (newV === undefined) {
        newV = oldToNewVert.size;
        oldToNewVert.set(oldV, newV);
        for (let p = 0; p < numProp; p++) newVertProperties.push(vertProperties[oldV * numProp + p]);
      }
      newTriVerts.push(newV);
    }
  }
  return {
    vertProperties: new Float32Array(newVertProperties),
    triVerts: new Uint32Array(newTriVerts),
    numProp,
    numVert: oldToNewVert.size,
    numTri: newTriVerts.length / 3,
  } as MeshData;
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
