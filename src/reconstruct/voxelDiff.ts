// Voxel symmetric-difference between two triangle-soup meshes, with
// localized, signed, sized "findings" instead of one scalar. Ported from
// scripts/inverse-cad/voxelDiff.mjs (the tool that made the headless loop
// converge — it turns "hausdorff 1.9" into "missing material cluster at
// [12,0,-5], extent 4×3×2"). Field names drop the headless `_mm` suffixes:
// the app's units are arbitrary.
//
// Voxelization: ray-parity per Z-column with XY triangle bucketing,
// half-open edge ownership (a column through a shared edge counts once),
// near-duplicate crossing dedupe, and a deterministic jitter fallback.

import type { TriangleSoup } from './slice2d';

const BUCKET_VOXELS = 4;
const DEDUPE_TOL = 1e-7;
const MAX_GRID_VOXELS = 24e6;
const PAD_VOXELS = 2;
const DEFAULT_MAX_FINDINGS = 12;

export interface VoxelGrid {
  min: [number, number, number];
  size: [number, number, number];
  res: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function computeBBox(mesh: TriangleSoup): { min: [number, number, number]; max: [number, number, number] } {
  const { triangles } = mesh;
  const n = triangles.length;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function dedupeToEvenParity(zsIn: number[]): number[] {
  let zs = zsIn;
  while (zs.length % 2 !== 0 && zs.length > 1) {
    let bestGap = Infinity;
    let bestIdx = -1;
    for (let p = 0; p < zs.length - 1; p++) {
      const gap = zs[p + 1] - zs[p];
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = p;
      }
    }
    if (bestIdx < 0 || bestGap >= DEDUPE_TOL) break;
    zs = zs.slice(0, bestIdx).concat(zs.slice(bestIdx + 1));
  }
  return zs;
}

interface ValidTri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  area2: number;
}

/** Voxelize a triangle soup onto an explicit grid (1 = inside). */
export function voxelizeSoup(mesh: TriangleSoup, grid: VoxelGrid): Uint8Array {
  const { triangles } = mesh;
  const { min, size, res } = grid;
  const [nx, ny, nz] = size;
  const occ = new Uint8Array(nx * ny * nz);
  const triCount = triangles.length / 9;
  if (triCount === 0 || nx <= 0 || ny <= 0 || nz <= 0) return occ;

  const valid: ValidTri[] = [];
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

  const bxCount = Math.max(1, Math.ceil(nx / BUCKET_VOXELS));
  const byCount = Math.max(1, Math.ceil(ny / BUCKET_VOXELS));
  const buckets: Array<number[] | undefined> = new Array(bxCount * byCount);
  const colOf = (x: number) => Math.floor((x - min[0]) / res);
  const rowOf = (y: number) => Math.floor((y - min[1]) / res);

  for (let vi = 0; vi < valid.length; vi++) {
    const tr = valid[vi];
    const iMin = clampInt(colOf(Math.min(tr.ax, tr.bx, tr.cx)), 0, nx - 1);
    const iMax = clampInt(colOf(Math.max(tr.ax, tr.bx, tr.cx)), 0, nx - 1);
    const jMin = clampInt(rowOf(Math.min(tr.ay, tr.by, tr.cy)), 0, ny - 1);
    const jMax = clampInt(rowOf(Math.max(tr.ay, tr.by, tr.cy)), 0, ny - 1);
    for (let bj = Math.floor(jMin / BUCKET_VOXELS); bj <= Math.floor(jMax / BUCKET_VOXELS); bj++) {
      for (let bi = Math.floor(iMin / BUCKET_VOXELS); bi <= Math.floor(iMax / BUCKET_VOXELS); bi++) {
        const key = bj * bxCount + bi;
        (buckets[key] ??= []).push(vi);
      }
    }
  }

  // Half-open edge ownership: a query point exactly ON an edge counts for
  // exactly ONE of the two triangles sharing it (see the headless original
  // for the parity-error this prevents).
  const ownsBoundary = (ax: number, ay: number, bx: number, by: number) => by > ay || (by === ay && bx < ax);

  function crossingsAt(qx: number, qy: number): number[] {
    const i = clampInt(colOf(qx), 0, nx - 1);
    const j = clampInt(rowOf(qy), 0, ny - 1);
    const list = buckets[Math.floor(j / BUCKET_VOXELS) * bxCount + Math.floor(i / BUCKET_VOXELS)];
    if (!list) return [];
    const zs: number[] = [];
    for (let k = 0; k < list.length; k++) {
      const tr = valid[list[k]];
      let ax = tr.ax, ay = tr.ay, bx = tr.bx, by = tr.by, cx = tr.cx, cy = tr.cy;
      if (tr.area2 < 0) {
        const tx = bx, ty = by;
        bx = cx; by = cy; cx = tx; cy = ty;
      }
      const eAB = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      const eBC = (cx - bx) * (qy - by) - (cy - by) * (qx - bx);
      const eCA = (ax - cx) * (qy - cy) - (ay - cy) * (qx - cx);
      const inside =
        (eAB > 0 || (eAB === 0 && ownsBoundary(ax, ay, bx, by))) &&
        (eBC > 0 || (eBC === 0 && ownsBoundary(bx, by, cx, cy))) &&
        (eCA > 0 || (eCA === 0 && ownsBoundary(cx, cy, ax, ay)));
      if (inside) {
        const v0x = tr.bx - tr.ax, v0y = tr.by - tr.ay;
        const v1x = tr.cx - tr.ax, v1y = tr.cy - tr.ay;
        const v2x = qx - tr.ax, v2y = qy - tr.ay;
        const v = (v2x * v1y - v1x * v2y) / tr.area2;
        const w = (v0x * v2y - v2x * v0y) / tr.area2;
        zs.push((1 - v - w) * tr.az + v * tr.bz + w * tr.cz);
      }
    }
    zs.sort((a, b) => a - b);
    return zs;
  }

  const idx3 = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const JITTER = 0.25 * res; // deterministic, not random

  for (let j = 0; j < ny; j++) {
    const qy = min[1] + (j + 0.5) * res;
    for (let i = 0; i < nx; i++) {
      const qx = min[0] + (i + 0.5) * res;
      let zs = dedupeToEvenParity(crossingsAt(qx, qy));
      if (zs.length % 2 !== 0) {
        zs = dedupeToEvenParity(crossingsAt(qx + JITTER, qy + JITTER));
        if (zs.length % 2 !== 0) zs = zs.slice(0, zs.length - 1);
      }
      for (let p = 0; p + 1 < zs.length; p += 2) {
        let kMin = Math.ceil((zs[p] - min[2]) / res - 0.5);
        let kMax = Math.floor((zs[p + 1] - min[2]) / res - 0.5);
        if (kMin < 0) kMin = 0;
        if (kMax > nz - 1) kMax = nz - 1;
        for (let k = kMin; k <= kMax; k++) occ[idx3(i, j, k)] = 1;
      }
    }
  }
  return occ;
}

/** A grid covering the union bbox of both meshes (padded), auto-resolved to
 *  maxDim/192 by default, coarsened to stay under MAX_GRID_VOXELS. */
export function makeSharedGrid(meshA: TriangleSoup, meshB: TriangleSoup, opts: { res?: number } = {}): VoxelGrid {
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
  let res = opts.res ?? maxDim / 192;

  const dimsToSize = (r: number): [number, number, number] => [
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
  return {
    min: [min[0] - PAD_VOXELS * res, min[1] - PAD_VOXELS * res, min[2] - PAD_VOXELS * res],
    size,
    res,
  };
}

function extractComponents(diffSign: Uint8Array, sign: number, grid: VoxelGrid): Array<{ sign: number; voxels: number[] }> {
  const [nx, ny, nz] = grid.size;
  const n = nx * ny * nz;
  const visited = new Uint8Array(n);
  const idx3 = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const components: Array<{ sign: number; voxels: number[] }> = [];
  const stack: number[] = [];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = idx3(i, j, k);
        if (diffSign[id] !== sign || visited[id]) continue;
        const voxels: number[] = [];
        visited[id] = 1;
        stack.length = 0;
        stack.push(id);
        while (stack.length) {
          const cur = stack.pop() as number;
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

/** Chessboard distance-to-boundary "diameter": how deep the blob is. */
function findingThickness(voxelIds: number[], grid: VoxelGrid): number {
  const [nx, ny] = grid.size;
  const res = grid.res;
  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity, kMin = Infinity, kMax = -Infinity;
  const coords: Array<[number, number, number]> = new Array(voxelIds.length);
  for (let t = 0; t < voxelIds.length; t++) {
    const id = voxelIds[t];
    const k = Math.floor(id / (nx * ny));
    const rem = id - k * nx * ny;
    const j = Math.floor(rem / nx);
    const i = rem - j * nx;
    coords[t] = [i, j, k];
    if (i < iMin) iMin = i;
    if (i > iMax) iMax = i;
    if (j < jMin) jMin = j;
    if (j > jMax) jMax = j;
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  const dx = iMax - iMin + 1, dy = jMax - jMin + 1, dz = kMax - kMin + 1;
  const mask = new Uint8Array(dx * dy * dz);
  const lIdx = (i: number, j: number, k: number) => (k * dy + j) * dx + i;
  for (const [i, j, k] of coords) mask[lIdx(i - iMin, j - jMin, k - kMin)] = 1;

  const dist = new Int32Array(dx * dy * dz).fill(-1);
  const queue: number[] = [];
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
        if (boundary) {
          dist[id] = 0;
          queue.push(id);
        }
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

export interface DiffFinding {
  id: string;
  sign: 'excess' | 'missing';
  volume: number;
  centroid: [number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Centroid position relative to the target's bbox (0..1 per axis). */
  relCentroid: [number, number, number];
  extent: [number, number, number];
  thickness: number;
  classification: 'thin-skin' | 'compact-feature';
  hint: string;
}

export interface VoxelDiffReport {
  grid: VoxelGrid;
  volumeIoU: number;
  excessVolume: number;
  missingVolume: number;
  targetVolume: number;
  candVolume: number;
  findings: DiffFinding[];
  totalFindings: number;
  discardedVolume: number;
}

function buildFinding(
  comp: { sign: number; voxels: number[] },
  grid: VoxelGrid,
  targetBBox: { min: [number, number, number]; max: [number, number, number] },
  targetSize: [number, number, number],
): Omit<DiffFinding, 'id'> {
  const { sign, voxels } = comp;
  const [nx, ny] = grid.size;
  const res = grid.res;
  const volume = voxels.length * res * res * res;

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
    sumX += cx;
    sumY += cy;
    sumZ += cz;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;
  }
  const count = voxels.length;
  const centroid: [number, number, number] = [sumX / count, sumY / count, sumZ / count];
  const bboxMin: [number, number, number] = [minX - res / 2, minY - res / 2, minZ - res / 2];
  const bboxMax: [number, number, number] = [maxX + res / 2, maxY + res / 2, maxZ + res / 2];
  const extent: [number, number, number] = [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]];
  const relCentroid = [0, 1, 2].map((a) =>
    targetSize[a] > 1e-9 ? (centroid[a] - targetBBox.min[a]) / targetSize[a] : 0,
  ) as [number, number, number];

  const thickness = findingThickness(voxels, grid);
  const maxExtent = Math.max(extent[0], extent[1], extent[2], 1e-9);
  const signName = sign === 1 ? 'excess' : 'missing';
  return {
    sign: signName,
    volume,
    centroid,
    bbox: { min: bboxMin, max: bboxMax },
    relCentroid,
    extent,
    thickness,
    classification: thickness < 2.5 * res || thickness / maxExtent < 0.15 ? 'thin-skin' : 'compact-feature',
    hint:
      signName === 'excess'
        ? 'candidate has material here that the target does not (protrusion too large or missing cut)'
        : 'target has material here that the candidate lacks (missing feature or cut too deep)',
  };
}

export interface VoxelDiffOptions {
  res?: number;
  /** Findings below this volume are noise; defaults to ~4 voxel volumes. */
  minFindingVolume?: number;
  maxFindings?: number;
}

/** Voxelize `target` and `candidate` on a shared grid; report volume overlap
 *  plus localized findings for every disagreement blob. */
export function voxelDiff(target: TriangleSoup, candidate: TriangleSoup, opts: VoxelDiffOptions = {}): VoxelDiffReport {
  const grid = makeSharedGrid(target, candidate, opts);
  const occT = voxelizeSoup(target, grid);
  const occC = voxelizeSoup(candidate, grid);
  const [nx, ny, nz] = grid.size;
  const voxelVol = grid.res ** 3;
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

  const targetBBox = computeBBox(target);
  const targetSize: [number, number, number] = [
    targetBBox.max[0] - targetBBox.min[0],
    targetBBox.max[1] - targetBBox.min[1],
    targetBBox.max[2] - targetBBox.min[2],
  ];

  const minFinding = opts.minFindingVolume ?? 4 * voxelVol;
  const maxFindings = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;

  const kept: Array<Omit<DiffFinding, 'id'>> = [];
  for (const comp of [...extractComponents(diffSign, 1, grid), ...extractComponents(diffSign, 2, grid)]) {
    if (comp.voxels.length * voxelVol < minFinding) continue;
    kept.push(buildFinding(comp, grid, targetBBox, targetSize));
  }
  kept.sort((a, b) => b.volume - a.volume);

  let discardedVolume = 0;
  for (let i = maxFindings; i < kept.length; i++) discardedVolume += kept[i].volume;

  return {
    grid,
    volumeIoU: unionCount > 0 ? interCount / unionCount : 1,
    excessVolume: (candCount - interCount) * voxelVol,
    missingVolume: (targetCount - interCount) * voxelVol,
    targetVolume: targetCount * voxelVol,
    candVolume: candCount * voxelVol,
    findings: kept.slice(0, maxFindings).map((f, i) => ({ id: 'F' + (i + 1), ...f })),
    totalFindings: kept.length,
    discardedVolume,
  };
}
