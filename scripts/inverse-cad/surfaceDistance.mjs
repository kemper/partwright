// Exact point -> triangle-mesh distance, replacing the point-cloud (nearest
// sampled-point) approximation in distance.mjs, which has a ~0.15mm noise
// floor even for identical meshes (two independent samples of the same
// surface are never exactly coincident). Here every query resolves to the
// true closest point on the actual triangle surface, so self-distance is
// bounded only by floating-point error.
//
// buildTriBvh    — AABB tree over the triangle soup (median split on the
//                  longest centroid-bounds axis, leaf <= 8 triangles).
// closestPointOnMesh — branch-and-bound nearest-triangle search; per-triangle
//                  math is Ericson's closest-point-on-triangle (Real-Time
//                  Collision Detection SS5.1.5).
// isInside       — ray-parity test: cast a ray, count triangle crossings via
//                  the same BVH, odd = inside. Grazing hits (a crossing whose
//                  barycentric coordinate is within 1e-9 of a triangle edge/
//                  vertex) make a cast's parity unreliable, so we retry with a
//                  small deterministic direction jitter (up to 4 attempts).
// signedMeshDistance — samples both meshes, computes exact signed distance
//                  each way, and reports chamfer/hausdorff/rms plus signed
//                  mean and excess/missing surface-area estimates.

import { samplePoints, triAreas } from './sampleMesh.mjs';

const LEAF_SIZE = 8;
const RAY_T_EPS = 1e-7; // ignore intersections at (or behind) the ray origin
const RAY_DET_EPS = 1e-12; // ray parallel to the triangle's plane
const BARY_EDGE_EPS = 1e-9; // "suspiciously close to an edge/vertex" per spec

// Primary cast along +X, then three small fixed tilts (deterministic, not
// random) used only when a cast's parity is unreliable.
const RAY_DIRECTIONS = [
  [1, 0, 0],
  [1, 0.017213, 0.007129],
  [1, -0.027103, 0.019283],
  [1, 0.011317, -0.031147],
];

// --- BVH construction -------------------------------------------------

// Build an AABB tree over `mesh.triangles` (triangle soup, 9 floats/tri).
// Returns a flat-array structure: per-node AABB (nodeMin*/nodeMax*),
// nodeLeft/nodeRight child ids (-1 for leaves), and nodeStart/nodeEnd
// ranges into `triIndex` (a reordering of triangle indices, not the raw
// triangle data) for leaves.
export function buildTriBvh(mesh) {
  const { triangles } = mesh;
  const triCount = triangles.length / 9;

  const triMinX = new Float64Array(triCount), triMinY = new Float64Array(triCount), triMinZ = new Float64Array(triCount);
  const triMaxX = new Float64Array(triCount), triMaxY = new Float64Array(triCount), triMaxZ = new Float64Array(triCount);
  const triCx = new Float64Array(triCount), triCy = new Float64Array(triCount), triCz = new Float64Array(triCount);

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = triangles[o], ay = triangles[o + 1], az = triangles[o + 2];
    const bx = triangles[o + 3], by = triangles[o + 4], bz = triangles[o + 5];
    const cx = triangles[o + 6], cy = triangles[o + 7], cz = triangles[o + 8];
    triMinX[t] = Math.min(ax, bx, cx); triMaxX[t] = Math.max(ax, bx, cx);
    triMinY[t] = Math.min(ay, by, cy); triMaxY[t] = Math.max(ay, by, cy);
    triMinZ[t] = Math.min(az, bz, cz); triMaxZ[t] = Math.max(az, bz, cz);
    triCx[t] = (ax + bx + cx) / 3; triCy[t] = (ay + by + cy) / 3; triCz[t] = (az + bz + cz) / 3;
  }

  const idx = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) idx[i] = i;

  const nodeMinX = [], nodeMinY = [], nodeMinZ = [];
  const nodeMaxX = [], nodeMaxY = [], nodeMaxZ = [];
  const nodeLeft = [], nodeRight = [], nodeStart = [], nodeEnd = [];

  function build(from, to) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = from; i < to; i++) {
      const t = idx[i];
      if (triMinX[t] < minX) minX = triMinX[t]; if (triMaxX[t] > maxX) maxX = triMaxX[t];
      if (triMinY[t] < minY) minY = triMinY[t]; if (triMaxY[t] > maxY) maxY = triMaxY[t];
      if (triMinZ[t] < minZ) minZ = triMinZ[t]; if (triMaxZ[t] > maxZ) maxZ = triMaxZ[t];
    }
    const id = nodeMinX.length;
    nodeMinX.push(minX); nodeMinY.push(minY); nodeMinZ.push(minZ);
    nodeMaxX.push(maxX); nodeMaxY.push(maxY); nodeMaxZ.push(maxZ);
    nodeLeft.push(-1); nodeRight.push(-1); nodeStart.push(-1); nodeEnd.push(-1);

    const count = to - from;
    if (count <= LEAF_SIZE) {
      nodeStart[id] = from;
      nodeEnd[id] = to;
      return id;
    }

    // Longest axis of the CENTROID bounds (not the triangle AABB above) —
    // this is what keeps the split balanced by triangle count.
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
    let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
    for (let i = from; i < to; i++) {
      const t = idx[i];
      const x = triCx[t], y = triCy[t], z = triCz[t];
      if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
      if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y;
      if (z < cMinZ) cMinZ = z; if (z > cMaxZ) cMaxZ = z;
    }
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const centroidArr = axis === 0 ? triCx : axis === 1 ? triCy : triCz;

    const mid = (from + to) >> 1;
    quickselectByValue(idx, from, to - 1, mid, centroidArr);

    const leftId = build(from, mid);
    const rightId = build(mid, to);
    nodeLeft[id] = leftId;
    nodeRight[id] = rightId;
    return id;
  }

  const root = triCount > 0 ? build(0, triCount) : -1;

  return {
    triangles,
    triIndex: idx,
    nodeMinX: Float64Array.from(nodeMinX), nodeMinY: Float64Array.from(nodeMinY), nodeMinZ: Float64Array.from(nodeMinZ),
    nodeMaxX: Float64Array.from(nodeMaxX), nodeMaxY: Float64Array.from(nodeMaxY), nodeMaxZ: Float64Array.from(nodeMaxZ),
    nodeLeft: Int32Array.from(nodeLeft), nodeRight: Int32Array.from(nodeRight),
    nodeStart: Int32Array.from(nodeStart), nodeEnd: Int32Array.from(nodeEnd),
    root,
    triCount,
  };
}

// Partition idx[from..to] (inclusive) around the k-th smallest `values[idx[i]]`
// — same quickselect as sampleMesh.mjs's buildKdTree, parametrized by a plain
// value array instead of a (points, axis) pair.
function quickselectByValue(idx, from, to, k, values) {
  while (from < to) {
    const pivot = values[idx[(from + to) >> 1]];
    let i = from, j = to;
    while (i <= j) {
      while (values[idx[i]] < pivot) i++;
      while (values[idx[j]] > pivot) j--;
      if (i <= j) {
        const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
        i++; j--;
      }
    }
    if (k <= j) to = j;
    else if (k >= i) from = i;
    else break;
  }
}

// --- Closest point on a single triangle --------------------------------

// Ericson, Real-Time Collision Detection SS5.1.5. Writes the closest point
// into `out` ({x,y,z}) and returns the squared distance. No allocation.
function closestPtTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.x = ax; out.y = ay; out.z = az;
    return sq3(px - ax, py - ay, pz - az);
  }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.x = bx; out.y = by; out.z = bz;
    return sq3(px - bx, py - by, pz - bz);
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const x = ax + v * abx, y = ay + v * aby, z = az + v * abz;
    out.x = x; out.y = y; out.z = z;
    return sq3(px - x, py - y, pz - z);
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.x = cx; out.y = cy; out.z = cz;
    return sq3(px - cx, py - cy, pz - cz);
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const x = ax + w * acx, y = ay + w * acy, z = az + w * acz;
    out.x = x; out.y = y; out.z = z;
    return sq3(px - x, py - y, pz - z);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const x = bx + w * (cx - bx), y = by + w * (cy - by), z = bz + w * (cz - bz);
    out.x = x; out.y = y; out.z = z;
    return sq3(px - x, py - y, pz - z);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const x = ax + abx * v + acx * w, y = ay + aby * v + acy * w, z = az + abz * v + acz * w;
  out.x = x; out.y = y; out.z = z;
  return sq3(px - x, py - y, pz - z);
}

function sq3(dx, dy, dz) { return dx * dx + dy * dy + dz * dz; }

// A single scratch point reused across leaf-triangle tests within one
// closestPointOnMesh call. Safe because everything here is synchronous.
const SCRATCH_PT = { x: 0, y: 0, z: 0 };

// Branch-and-bound nearest point on the whole mesh. Descends children
// ordered by AABB distance and prunes any node whose AABB distance is
// already >= the current best.
export function closestPointOnMesh(bvh, x, y, z) {
  if (bvh.root < 0) return { dist: Infinity, px: NaN, py: NaN, pz: NaN, triIndex: -1 };

  let bestDist2 = Infinity;
  let bestX = 0, bestY = 0, bestZ = 0, bestTri = -1;
  const { triangles, triIndex, nodeMinX, nodeMinY, nodeMinZ, nodeMaxX, nodeMaxY, nodeMaxZ, nodeLeft, nodeRight, nodeStart, nodeEnd } = bvh;

  function aabbDist2(id) {
    const minX = nodeMinX[id], minY = nodeMinY[id], minZ = nodeMinZ[id];
    const maxX = nodeMaxX[id], maxY = nodeMaxY[id], maxZ = nodeMaxZ[id];
    let dx = 0, dy = 0, dz = 0;
    if (x < minX) dx = minX - x; else if (x > maxX) dx = x - maxX;
    if (y < minY) dy = minY - y; else if (y > maxY) dy = y - maxY;
    if (z < minZ) dz = minZ - z; else if (z > maxZ) dz = z - maxZ;
    return dx * dx + dy * dy + dz * dz;
  }

  function visit(id) {
    if (id < 0 || aabbDist2(id) >= bestDist2) return;
    const left = nodeLeft[id], right = nodeRight[id];
    if (left < 0) {
      const start = nodeStart[id], end = nodeEnd[id];
      for (let i = start; i < end; i++) {
        const t = triIndex[i];
        const o = t * 9;
        const d2 = closestPtTriangle(
          x, y, z,
          triangles[o], triangles[o + 1], triangles[o + 2],
          triangles[o + 3], triangles[o + 4], triangles[o + 5],
          triangles[o + 6], triangles[o + 7], triangles[o + 8],
          SCRATCH_PT,
        );
        if (d2 < bestDist2) {
          bestDist2 = d2; bestX = SCRATCH_PT.x; bestY = SCRATCH_PT.y; bestZ = SCRATCH_PT.z; bestTri = t;
        }
      }
      return;
    }
    const dl = aabbDist2(left), dr = aabbDist2(right);
    if (dl <= dr) { visit(left); if (dr < bestDist2) visit(right); }
    else { visit(right); if (dl < bestDist2) visit(left); }
  }

  visit(bvh.root);
  return { dist: Math.sqrt(bestDist2), px: bestX, py: bestY, pz: bestZ, triIndex: bestTri };
}

// --- Ray/AABB + ray/triangle for the inside test -----------------------

// Slab test over t in [0, Infinity). Handles axis-aligned ray directions
// (d === 0) explicitly rather than relying on IEEE-Infinity division, since
// the primary ray direction is exactly +X (dy = dz = 0).
function rayHitsAabb(minX, minY, minZ, maxX, maxY, maxZ, ox, oy, oz, dx, dy, dz) {
  let tmin = 0, tmax = Infinity;
  if (dx === 0) {
    if (ox < minX || ox > maxX) return false;
  } else {
    let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (dy === 0) {
    if (oy < minY || oy > maxY) return false;
  } else {
    let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (dz === 0) {
    if (oz < minZ || oz > maxZ) return false;
  } else {
    let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

// Moeller-Trumbore, non-culling (hits from either side count). Returns
// null for a miss/parallel/behind-origin, or { t, u, v, w } (w = 1-u-v)
// on a hit.
function rayTriangleIntersect(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < RAY_DET_EPS) return null;
  const invDet = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * hx + sy * hy + sz * hz) * invDet;
  if (u < -BARY_EDGE_EPS || u > 1 + BARY_EDGE_EPS) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < -BARY_EDGE_EPS || u + v > 1 + BARY_EDGE_EPS) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  if (t <= RAY_T_EPS) return null;
  return { t, u, v, w: 1 - u - v };
}

// Traverse the whole BVH along the ray (pruned only by ray/AABB overlap,
// not by a "best" bound — we need every crossing for parity) and count
// triangle hits. `reliable` is false when any hit's barycentric coordinate
// is within BARY_EDGE_EPS of a triangle edge/vertex, meaning the ray grazed
// a shared boundary closely enough that the count could be off by one.
function castRayCrossingCount(bvh, ox, oy, oz, dx, dy, dz) {
  if (bvh.root < 0) return { count: 0, reliable: true };
  let count = 0;
  let grazing = false;
  const { triangles, triIndex, nodeMinX, nodeMinY, nodeMinZ, nodeMaxX, nodeMaxY, nodeMaxZ, nodeLeft, nodeRight, nodeStart, nodeEnd } = bvh;

  function visit(id) {
    if (id < 0) return;
    if (!rayHitsAabb(nodeMinX[id], nodeMinY[id], nodeMinZ[id], nodeMaxX[id], nodeMaxY[id], nodeMaxZ[id], ox, oy, oz, dx, dy, dz)) return;
    const left = nodeLeft[id], right = nodeRight[id];
    if (left < 0) {
      const start = nodeStart[id], end = nodeEnd[id];
      for (let i = start; i < end; i++) {
        const t = triIndex[i];
        const o = t * 9;
        const hit = rayTriangleIntersect(
          ox, oy, oz, dx, dy, dz,
          triangles[o], triangles[o + 1], triangles[o + 2],
          triangles[o + 3], triangles[o + 4], triangles[o + 5],
          triangles[o + 6], triangles[o + 7], triangles[o + 8],
        );
        if (hit) {
          count++;
          if (hit.u < BARY_EDGE_EPS || hit.v < BARY_EDGE_EPS || hit.w < BARY_EDGE_EPS) grazing = true;
        }
      }
      return;
    }
    visit(left);
    visit(right);
  }
  visit(bvh.root);
  return { count, reliable: !grazing };
}

// Ray-parity inside/outside test. `mesh` is accepted alongside `bvh` to
// match the module's (bvh, mesh, x, y, z) shape used elsewhere, though the
// BVH already carries the triangle data it was built from.
export function isInside(bvh, mesh, x, y, z) {
  let lastCount = 0;
  for (const [dx, dy, dz] of RAY_DIRECTIONS) {
    const { count, reliable } = castRayCrossingCount(bvh, x, y, z, dx, dy, dz);
    lastCount = count;
    if (reliable) return (count % 2) === 1;
  }
  // All 4 directions grazed something — fall back to the last attempt's
  // parity rather than throwing; this only happens on adversarial/degenerate
  // input and the point is, by construction, extremely close to the surface.
  return (lastCount % 2) === 1;
}

// --- Aggregate signed distance ------------------------------------------

function statsSigned(signed) {
  const n = signed.length;
  const absVals = new Float64Array(n);
  let sum = 0, sumSq = 0, max = 0, sumSigned = 0;
  for (let i = 0; i < n; i++) {
    const v = signed[i];
    const a = Math.abs(v);
    absVals[i] = a;
    sum += a; sumSq += a * a; sumSigned += v;
    if (a > max) max = a;
  }
  return { mean: sum / n, rms: Math.sqrt(sumSq / n), max, meanSigned: sumSigned / n, absVals };
}

function quantile(sortedAbs, q) {
  const i = Math.min(sortedAbs.length - 1, Math.max(0, Math.floor(q * (sortedAbs.length - 1))));
  return sortedAbs[i];
}

// Score `candidate` vs `target` with exact point-to-triangle-surface
// distance in both directions. Mirrors meshDistance's report shape
// (chamfer/hausdorff/rms + candToTarget/targetToCand quantiles) and adds
// method/meanSigned/excessArea_mm2/missingArea_mm2.
export function signedMeshDistance(target, candidate, opts = {}) {
  const samples = opts.samples ?? 20000;
  const seed = opts.seed ?? 1;
  const insideSign = opts.insideSign ?? true;
  const tol = opts.tol ?? 0.05;
  const keepPoints = opts.keepPoints ?? false;

  const bvhTarget = buildTriBvh(target);
  const bvhCandidate = buildTriBvh(candidate);

  const candPts = samplePoints(candidate, samples, { seed: seed + 1 });
  const targetPts = samplePoints(target, samples, { seed });

  const candSigned = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = candPts[i * 3], y = candPts[i * 3 + 1], z = candPts[i * 3 + 2];
    const { dist } = closestPointOnMesh(bvhTarget, x, y, z);
    const sign = insideSign && isInside(bvhTarget, target, x, y, z) ? -1 : 1;
    candSigned[i] = sign * dist;
  }

  const targetSigned = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = targetPts[i * 3], y = targetPts[i * 3 + 1], z = targetPts[i * 3 + 2];
    const { dist } = closestPointOnMesh(bvhCandidate, x, y, z);
    const sign = insideSign && isInside(bvhCandidate, candidate, x, y, z) ? -1 : 1;
    targetSigned[i] = sign * dist;
  }

  const candStats = statsSigned(candSigned);
  const targetStats = statsSigned(targetSigned);
  const candSortedAbs = Float64Array.from(candStats.absVals).sort();
  const targetSortedAbs = Float64Array.from(targetStats.absVals).sort();

  const candArea = triAreas(candidate.triangles).total;
  const targetArea = triAreas(target.triangles).total;

  let candExcessCount = 0, candMissingCount = 0;
  for (let i = 0; i < samples; i++) {
    if (candSigned[i] > tol) candExcessCount++;
    else if (candSigned[i] < -tol) candMissingCount++;
  }
  let targetExcessCount = 0, targetMissingCount = 0;
  for (let i = 0; i < samples; i++) {
    if (targetSigned[i] > tol) targetExcessCount++;
    else if (targetSigned[i] < -tol) targetMissingCount++;
  }

  const candToTarget = {
    mean: candStats.mean, rms: candStats.rms, max: candStats.max,
    p50: quantile(candSortedAbs, 0.5), p90: quantile(candSortedAbs, 0.9), p99: quantile(candSortedAbs, 0.99),
    meanSigned: candStats.meanSigned,
    excessArea_mm2: (candExcessCount / samples) * candArea,
    missingArea_mm2: (candMissingCount / samples) * candArea,
  };
  const targetToCand = {
    mean: targetStats.mean, rms: targetStats.rms, max: targetStats.max,
    p50: quantile(targetSortedAbs, 0.5), p90: quantile(targetSortedAbs, 0.9), p99: quantile(targetSortedAbs, 0.99),
    meanSigned: targetStats.meanSigned,
    excessArea_mm2: (targetExcessCount / samples) * targetArea,
    missingArea_mm2: (targetMissingCount / samples) * targetArea,
  };

  const result = {
    method: 'point-to-triangle-bvh',
    samples,
    chamfer: 0.5 * (candToTarget.mean + targetToCand.mean),
    hausdorff: Math.max(candToTarget.max, targetToCand.max),
    rms: Math.sqrt(0.5 * (candToTarget.rms * candToTarget.rms + targetToCand.rms * targetToCand.rms)),
    candToTarget,
    targetToCand,
  };

  if (keepPoints) {
    result.candPoints = candPts;
    result.candSigned = candSigned;
    result.targetPoints = targetPts;
    result.targetSigned = targetSigned;
  }

  return result;
}
