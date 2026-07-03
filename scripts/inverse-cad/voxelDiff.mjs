// voxelDiff.mjs — voxel symmetric-difference between two triangle-soup
// meshes, with localized, signed, sized "findings" instead of one scalar.
//
// Today's mesh-distance metrics (distance.mjs) report a single chamfer/
// Hausdorff number. That tells an agent *how far off* a candidate is, not
// *where* or *what kind* of defect. This module voxelizes both meshes on a
// shared grid and reports, per connected blob of disagreement: whether the
// candidate has extra material ('excess') or is missing material
// ('missing'), its volume, where it sits (world centroid/bbox + a position
// relative to the target's own bbox), how "thick" it is, and a one-sentence
// hint — enough to fix code without a visual roundtrip.
//
// Exports:
//   voxelizeMesh(mesh, grid)              -> Uint8Array occupancy (1 = inside)
//   makeSharedGrid(meshA, meshB, opts)     -> grid covering both meshes
//   voxelDiff(target, candidate, opts)     -> { grid, volumeIoU, findings, ... }
//
// Voxelization method: ray-parity per Z-column. Triangles are bucketed into
// a coarse 2D XY grid so each column only tests nearby triangles instead of
// the whole mesh. For each column we collect every z where the vertical ray
// crosses a (XY-nondegenerate) triangle, sort them, and fill voxels between
// successive pairs (0-1, 2-3, ...). Everything is deterministic — no
// Math.random anywhere, including the odd-crossing-count jitter fallback.

const BUCKET_VOXELS = 4; // "a few voxels" per XY bucket cell, per spec
const DEDUPE_TOL = 1e-7; // near-identical crossing merge tolerance
const MAX_GRID_VOXELS = 24e6;
const PAD_VOXELS = 2;
const DEFAULT_MIN_FINDING_MM3 = 0.5;
const DEFAULT_MAX_FINDINGS = 12;

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Local, dependency-free bbox helper (deliberately not imported from
// stl.mjs — this module stays a pure leaf with no sibling imports).
function computeBBox(mesh) {
  const { triangles } = mesh;
  const n = triangles.length;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// Given a sorted array of crossing z's, try to restore even parity by
// dropping one of the closest adjacent pair, repeatedly, as long as that
// pair is within DEDUPE_TOL. This is the "shared edge" fixup: a ray that
// passes exactly through an edge shared by two triangles of the same
// continuous surface can get double-registered as two near-identical
// crossings of what is really one true crossing. It intentionally does
// NOT touch an already-even crossing list — two *genuinely* coincident
// surfaces (e.g. two separate watertight solids touching flush) produce an
// even count whose successive-pair fill already covers the join with no
// gap, and merging those would wrongly break parity.
function dedupeToEvenParity(zsIn) {
  let zs = zsIn;
  while (zs.length % 2 !== 0 && zs.length > 1) {
    let bestGap = Infinity;
    let bestIdx = -1;
    for (let p = 0; p < zs.length - 1; p++) {
      const gap = zs[p + 1] - zs[p];
      if (gap < bestGap) { bestGap = gap; bestIdx = p; }
    }
    if (bestIdx < 0 || bestGap >= DEDUPE_TOL) break;
    zs = zs.slice(0, bestIdx).concat(zs.slice(bestIdx + 1));
  }
  return zs;
}

// Voxelize a triangle-soup mesh onto an explicit grid. `grid.size` is voxel
// counts [nx, ny, nz]; a voxel (i,j,k)'s world center is
// grid.min + (i+0.5, j+0.5, k+0.5) * grid.res.
export function voxelizeMesh(mesh, grid) {
  const { triangles } = mesh;
  const { min, size, res } = grid;
  const [nx, ny, nz] = size;
  const occ = new Uint8Array(nx * ny * nz);
  const triCount = triangles.length / 9;
  if (triCount === 0 || nx <= 0 || ny <= 0 || nz <= 0) return occ;

  // Precompute per-triangle data for every XY-nondegenerate triangle.
  // Vertical/zero-XY-area triangles can't produce a vertical-ray crossing,
  // so they're dropped up front.
  const valid = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = triangles[o], ay = triangles[o + 1], az = triangles[o + 2];
    const bx = triangles[o + 3], by = triangles[o + 4], bz = triangles[o + 5];
    const cx = triangles[o + 6], cy = triangles[o + 7], cz = triangles[o + 8];
    const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area2) < 1e-12) continue;
    valid.push({ ax, ay, az, bx, by, bz, cx, cy, cz, area2 });
  }
  if (valid.length === 0) return occ;

  // Bucket triangles into a coarse XY grid (BUCKET_VOXELS voxels per cell)
  // so each column only tests nearby candidates.
  const bxCount = Math.max(1, Math.ceil(nx / BUCKET_VOXELS));
  const byCount = Math.max(1, Math.ceil(ny / BUCKET_VOXELS));
  const buckets = new Array(bxCount * byCount);
  const colOf = (x) => Math.floor((x - min[0]) / res);
  const rowOf = (y) => Math.floor((y - min[1]) / res);

  for (let vi = 0; vi < valid.length; vi++) {
    const tr = valid[vi];
    const minXw = Math.min(tr.ax, tr.bx, tr.cx);
    const maxXw = Math.max(tr.ax, tr.bx, tr.cx);
    const minYw = Math.min(tr.ay, tr.by, tr.cy);
    const maxYw = Math.max(tr.ay, tr.by, tr.cy);
    const iMin = clampInt(colOf(minXw), 0, nx - 1);
    const iMax = clampInt(colOf(maxXw), 0, nx - 1);
    const jMin = clampInt(rowOf(minYw), 0, ny - 1);
    const jMax = clampInt(rowOf(maxYw), 0, ny - 1);
    const biMin = Math.floor(iMin / BUCKET_VOXELS);
    const biMax = Math.floor(iMax / BUCKET_VOXELS);
    const bjMin = Math.floor(jMin / BUCKET_VOXELS);
    const bjMax = Math.floor(jMax / BUCKET_VOXELS);
    for (let bj = bjMin; bj <= bjMax; bj++) {
      for (let bi = biMin; bi <= biMax; bi++) {
        const key = bj * bxCount + bi;
        (buckets[key] ??= []).push(vi);
      }
    }
  }

  function bucketAt(x, y) {
    const i = clampInt(colOf(x), 0, nx - 1);
    const j = clampInt(rowOf(y), 0, ny - 1);
    const bi = Math.floor(i / BUCKET_VOXELS);
    const bj = Math.floor(j / BUCKET_VOXELS);
    return buckets[bj * bxCount + bi];
  }

  // Half-open (edge-ownership) point-in-triangle: a query point strictly
  // inside counts; a point exactly ON an edge counts for exactly ONE of the
  // two triangles sharing that edge. Without this, a column through a face
  // diagonal registers in both coplanar triangles, yielding crossing pairs
  // like z=0,0,10,10 whose successive-pair fill covers nothing (an EVEN
  // parity error the odd-count fixups can never see). The tie-break is a
  // lexicographic predicate on the DIRECTED edge: the two triangles traverse
  // a shared edge in opposite directions (consistent 3D winding projects to
  // opposite 2D directions after CCW normalization), so exactly one owns it.
  function ownsBoundary(ax, ay, bx, by) {
    return by > ay || (by === ay && bx < ax);
  }

  function crossingsAt(qx, qy) {
    const list = bucketAt(qx, qy);
    if (!list) return [];
    const zs = [];
    for (let k = 0; k < list.length; k++) {
      const tr = valid[list[k]];
      // Normalize projected winding to CCW for the edge tests.
      let ax = tr.ax, ay = tr.ay, bx = tr.bx, by = tr.by, cx = tr.cx, cy = tr.cy;
      if (tr.area2 < 0) { const tx = bx, ty = by; bx = cx; by = cy; cx = tx; cy = ty; }
      const eAB = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      const eBC = (cx - bx) * (qy - by) - (cy - by) * (qx - bx);
      const eCA = (ax - cx) * (qy - cy) - (ay - cy) * (qx - cx);
      const inside =
        (eAB > 0 || (eAB === 0 && ownsBoundary(ax, ay, bx, by))) &&
        (eBC > 0 || (eBC === 0 && ownsBoundary(bx, by, cx, cy))) &&
        (eCA > 0 || (eCA === 0 && ownsBoundary(cx, cy, ax, ay)));
      if (inside) {
        // Barycentrics from the ORIGINAL vertex order (signed area handles
        // orientation) for the z interpolation.
        const v0x = tr.bx - tr.ax, v0y = tr.by - tr.ay;
        const v1x = tr.cx - tr.ax, v1y = tr.cy - tr.ay;
        const v2x = qx - tr.ax, v2y = qy - tr.ay;
        const v = (v2x * v1y - v1x * v2y) / tr.area2;
        const w = (v0x * v2y - v2x * v0y) / tr.area2;
        const u = 1 - v - w;
        zs.push(u * tr.az + v * tr.bz + w * tr.cz);
      }
    }
    zs.sort((a, b) => a - b);
    return zs;
  }

  const idx3 = (i, j, k) => (k * ny + j) * nx + i;
  const JITTER = 0.25 * res; // deterministic, not random

  for (let j = 0; j < ny; j++) {
    const qy = min[1] + (j + 0.5) * res;
    for (let i = 0; i < nx; i++) {
      const qx = min[0] + (i + 0.5) * res;
      let zs = dedupeToEvenParity(crossingsAt(qx, qy));
      if (zs.length % 2 !== 0) {
        zs = dedupeToEvenParity(crossingsAt(qx + JITTER, qy + JITTER));
        if (zs.length % 2 !== 0) zs = zs.slice(0, zs.length - 1); // last-resort safety
      }
      for (let p = 0; p + 1 < zs.length; p += 2) {
        const z0 = zs[p], z1 = zs[p + 1];
        let kMin = Math.ceil((z0 - min[2]) / res - 0.5);
        let kMax = Math.floor((z1 - min[2]) / res - 0.5);
        if (kMin < 0) kMin = 0;
        if (kMax > nz - 1) kMax = nz - 1;
        for (let k = kMin; k <= kMax; k++) occ[idx3(i, j, k)] = 1;
      }
    }
  }

  return occ;
}

// A grid covering the union bbox of both meshes, padded by PAD_VOXELS
// voxels on every side. Resolution defaults to max(0.15, maxDim/256),
// coarsened (never refined) if that would exceed MAX_GRID_VOXELS.
export function makeSharedGrid(meshA, meshB, opts = {}) {
  const bbA = computeBBox(meshA);
  const bbB = computeBBox(meshB);
  const min = [
    Math.min(bbA.min[0], bbB.min[0]),
    Math.min(bbA.min[1], bbB.min[1]),
    Math.min(bbA.min[2], bbB.min[2]),
  ];
  const max = [
    Math.max(bbA.max[0], bbB.max[0]),
    Math.max(bbA.max[1], bbB.max[1]),
    Math.max(bbA.max[2], bbB.max[2]),
  ];
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const maxDim = Math.max(dims[0], dims[1], dims[2], 1e-9);
  let res = opts.res ?? Math.max(0.15, maxDim / 256);

  const dimsToSize = (r) => [
    Math.ceil(dims[0] / r) + 2 * PAD_VOXELS,
    Math.ceil(dims[1] / r) + 2 * PAD_VOXELS,
    Math.ceil(dims[2] / r) + 2 * PAD_VOXELS,
  ];

  let size = dimsToSize(res);
  const total = size[0] * size[1] * size[2];
  if (total > MAX_GRID_VOXELS) {
    res *= Math.cbrt(total / MAX_GRID_VOXELS);
    size = dimsToSize(res);
  }

  const paddedMin = [
    min[0] - PAD_VOXELS * res,
    min[1] - PAD_VOXELS * res,
    min[2] - PAD_VOXELS * res,
  ];
  return { min: paddedMin, size, res };
}

// 26-connected BFS over the diff-sign grid, grouping voxels of the given
// sign (1 = excess, 2 = missing) into components. Returns an array of
// { sign, voxels } where voxels is a flat array of grid indices.
function extractComponents(diffSign, sign, grid) {
  const [nx, ny, nz] = grid.size;
  const n = nx * ny * nz;
  const visited = new Uint8Array(n);
  const idx3 = (i, j, k) => (k * ny + j) * nx + i;
  const components = [];
  const stack = [];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = idx3(i, j, k);
        if (diffSign[id] !== sign || visited[id]) continue;
        const voxels = [];
        visited[id] = 1;
        stack.length = 0;
        stack.push(id);
        while (stack.length) {
          const cur = stack.pop();
          voxels.push(cur);
          const cz = Math.floor(cur / (nx * ny));
          const rem = cur - cz * nx * ny;
          const cy = Math.floor(rem / nx);
          const cx = rem - cy * nx;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const nxp = cx + dx, nyp = cy + dy, nzp = cz + dz;
                if (nxp < 0 || nyp < 0 || nzp < 0 || nxp >= nx || nyp >= ny || nzp >= nz) continue;
                const nid = idx3(nxp, nyp, nzp);
                if (diffSign[nid] === sign && !visited[nid]) {
                  visited[nid] = 1;
                  stack.push(nid);
                }
              }
            }
          }
        }
        components.push({ sign, voxels });
      }
    }
  }
  return components;
}

// Chessboard (26-neighbour) distance-to-boundary over a finding's own
// voxels, localized to its own bbox. Returns 2 * (max distance + 0.5 voxel)
// * res — an approximate "how deep is this blob" diameter: a 1-voxel-thick
// shell has every voxel on the boundary (distance 0), so this evaluates to
// exactly one voxel's width; a compact blob's center voxel sits several
// voxels deep, giving a larger diameter.
function findingThickness(voxelIds, grid) {
  const [nx, ny] = grid.size;
  const res = grid.res;
  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity, kMin = Infinity, kMax = -Infinity;
  const coords = new Array(voxelIds.length);
  for (let t = 0; t < voxelIds.length; t++) {
    const id = voxelIds[t];
    const k = Math.floor(id / (nx * ny));
    const rem = id - k * nx * ny;
    const j = Math.floor(rem / nx);
    const i = rem - j * nx;
    coords[t] = [i, j, k];
    if (i < iMin) iMin = i; if (i > iMax) iMax = i;
    if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    if (k < kMin) kMin = k; if (k > kMax) kMax = k;
  }
  const dx = iMax - iMin + 1, dy = jMax - jMin + 1, dz = kMax - kMin + 1;
  const mask = new Uint8Array(dx * dy * dz);
  const lIdx = (i, j, k) => (k * dy + j) * dx + i;
  for (const [i, j, k] of coords) mask[lIdx(i - iMin, j - jMin, k - kMin)] = 1;

  const dist = new Int32Array(dx * dy * dz).fill(-1);
  const queue = [];
  for (let k = 0; k < dz; k++) {
    for (let j = 0; j < dy; j++) {
      for (let i = 0; i < dx; i++) {
        const id = lIdx(i, j, k);
        if (!mask[id]) continue;
        let boundary = false;
        for (let ddz = -1; ddz <= 1 && !boundary; ddz++) {
          for (let ddy = -1; ddy <= 1 && !boundary; ddy++) {
            for (let ddx = -1; ddx <= 1; ddx++) {
              if (ddx === 0 && ddy === 0 && ddz === 0) continue;
              const ni = i + ddx, nj = j + ddy, nk = k + ddz;
              if (ni < 0 || nj < 0 || nk < 0 || ni >= dx || nj >= dy || nk >= dz || !mask[lIdx(ni, nj, nk)]) {
                boundary = true;
                break;
              }
            }
          }
        }
        if (boundary) { dist[id] = 0; queue.push(id); }
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = dist[id];
    const k = Math.floor(id / (dx * dy));
    const rem = id - k * dx * dy;
    const j = Math.floor(rem / dx);
    const i = rem - j * dx;
    for (let ddz = -1; ddz <= 1; ddz++) {
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddx = -1; ddx <= 1; ddx++) {
          if (ddx === 0 && ddy === 0 && ddz === 0) continue;
          const ni = i + ddx, nj = j + ddy, nk = k + ddz;
          if (ni < 0 || nj < 0 || nk < 0 || ni >= dx || nj >= dy || nk >= dz) continue;
          const nid = lIdx(ni, nj, nk);
          if (!mask[nid] || dist[nid] !== -1) continue;
          dist[nid] = d + 1;
          queue.push(nid);
        }
      }
    }
  }
  let maxD = 0;
  for (let t = 0; t < dist.length; t++) if (mask[t] && dist[t] > maxD) maxD = dist[t];
  return 2 * (maxD + 0.5) * res;
}

function buildFinding(comp, grid, targetBBox, targetSize) {
  const { sign, voxels } = comp;
  const [nx, ny] = grid.size;
  const res = grid.res;
  const voxelVol = res * res * res;
  const volume_mm3 = voxels.length * voxelVol;

  let sumX = 0, sumY = 0, sumZ = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const id of voxels) {
    const k = Math.floor(id / (nx * ny));
    const rem = id - k * nx * ny;
    const j = Math.floor(rem / nx);
    const i = rem - j * nx;
    const cx = grid.min[0] + (i + 0.5) * res;
    const cy = grid.min[1] + (j + 0.5) * res;
    const cz = grid.min[2] + (k + 0.5) * res;
    sumX += cx; sumY += cy; sumZ += cz;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
  }
  const count = voxels.length;
  const centroid = [sumX / count, sumY / count, sumZ / count];
  const bboxMin = [minX - res / 2, minY - res / 2, minZ - res / 2];
  const bboxMax = [maxX + res / 2, maxY + res / 2, maxZ + res / 2];
  const extent_mm = [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]];
  const relCentroid = [0, 1, 2].map((a) =>
    targetSize[a] > 1e-9 ? (centroid[a] - targetBBox.min[a]) / targetSize[a] : 0,
  );

  const thickness_mm = findingThickness(voxels, grid);
  const maxExtent = Math.max(extent_mm[0], extent_mm[1], extent_mm[2], 1e-9);
  const classification =
    thickness_mm < 2.5 * res || thickness_mm / maxExtent < 0.15 ? 'thin-skin' : 'compact-feature';

  const signName = sign === 1 ? 'excess' : 'missing';
  const hint =
    signName === 'excess'
      ? 'candidate has material here that the target does not (protrusion too large or missing cut)'
      : 'target has material here that the candidate lacks (missing feature or cut too deep)';

  return {
    sign: signName,
    volume_mm3,
    centroid,
    bbox: { min: bboxMin, max: bboxMax },
    relCentroid,
    extent_mm,
    thickness_mm,
    classification,
    hint,
  };
}

// Headline API: voxelize `target` and `candidate` on a shared grid and
// report volume overlap + localized findings for every diff blob.
export function voxelDiff(target, candidate, opts = {}) {
  const grid = makeSharedGrid(target, candidate, opts);
  const occT = voxelizeMesh(target, grid);
  const occC = voxelizeMesh(candidate, grid);
  const [nx, ny, nz] = grid.size;
  const res = grid.res;
  const voxelVol = res * res * res;
  const n = nx * ny * nz;

  // 0 = agree, 1 = excess (candidate only), 2 = missing (target only).
  const diffSign = new Uint8Array(n);
  let targetCount = 0, candCount = 0, interCount = 0;
  for (let idx = 0; idx < n; idx++) {
    const t = occT[idx], c = occC[idx];
    if (t) targetCount++;
    if (c) candCount++;
    if (t && c) interCount++;
    else if (t) diffSign[idx] = 2;
    else if (c) diffSign[idx] = 1;
  }
  const unionCount = targetCount + candCount - interCount;
  const volumeIoU = unionCount > 0 ? interCount / unionCount : 1;
  const excess_mm3 = (candCount - interCount) * voxelVol;
  const missing_mm3 = (targetCount - interCount) * voxelVol;
  const targetVol_mm3 = targetCount * voxelVol;
  const candVol_mm3 = candCount * voxelVol;

  const targetBBox = computeBBox(target);
  const targetSize = [
    targetBBox.max[0] - targetBBox.min[0],
    targetBBox.max[1] - targetBBox.min[1],
    targetBBox.max[2] - targetBBox.min[2],
  ];

  const minFinding = opts.minFinding_mm3 ?? DEFAULT_MIN_FINDING_MM3;
  const maxFindings = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;

  const rawComponents = [
    ...extractComponents(diffSign, 1, grid),
    ...extractComponents(diffSign, 2, grid),
  ];

  const kept = [];
  for (const comp of rawComponents) {
    const volume = comp.voxels.length * voxelVol;
    if (volume < minFinding) continue;
    kept.push(buildFinding(comp, grid, targetBBox, targetSize));
  }
  kept.sort((a, b) => b.volume_mm3 - a.volume_mm3);

  const totalFindings = kept.length;
  let discardedVolume_mm3 = 0;
  for (let i = maxFindings; i < kept.length; i++) discardedVolume_mm3 += kept[i].volume_mm3;
  const findings = kept.slice(0, maxFindings).map((f, i) => ({ id: 'F' + (i + 1), ...f }));

  return {
    grid: { res: grid.res, min: grid.min, size: grid.size },
    volumeIoU,
    excess_mm3,
    missing_mm3,
    targetVol_mm3,
    candVol_mm3,
    findings,
    totalFindings,
    discardedVolume_mm3,
  };
}
