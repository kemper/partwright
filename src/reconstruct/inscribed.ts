// Inscribed-primitive fitting: the largest axis-aligned box or Z-axis
// cylinder that fits entirely INSIDE a mesh, measured (not guessed) from a
// ray-parity occupancy grid. This is the "fill 80% of the organic volume
// with one clean primitive" instrument: the caller unions the primitive
// with a section-interpolated remainder, or uses the params as measured
// dimensions for semantic code.
//
// Box: largest inscribed cube via 3D dynamic programming, then greedy
// per-axis extension (each growth step re-verified against the occupancy,
// so the result is guaranteed inside up to voxel resolution).
// Cylinder: a coarse set of candidate Z-ranges; for each, the AND-map of
// solid columns over the range gets a chessboard distance transform whose
// max is the largest inscribed circle. Best πr²·h wins. Heuristics by
// design — results carry the achieved volume fraction so callers can judge.

import type { TriangleSoup } from './slice2d';
import { voxelizeSoup, makeSharedGrid, type VoxelGrid } from './voxelDiff';

export interface InscribedBox {
  kind: 'box';
  center: [number, number, number];
  size: [number, number, number];
  volume: number;
  /** Fraction of the mesh's voxel volume this primitive covers. */
  volumeFraction: number;
}

export interface InscribedCylinder {
  kind: 'cylinder';
  center: [number, number];
  r: number;
  z0: number;
  z1: number;
  volume: number;
  volumeFraction: number;
}

export interface InscribedOptions {
  /** Grid resolution override; defaults to maxDim/128 (≈2M voxels). */
  res?: number;
}

interface Occupancy {
  occ: Uint8Array;
  grid: VoxelGrid;
  solidCount: number;
}

function buildOccupancy(soup: TriangleSoup, opts: InscribedOptions): Occupancy {
  // makeSharedGrid with the same mesh twice = a padded grid over its bbox.
  let grid = makeSharedGrid(soup, soup, {});
  const maxDim = Math.max(
    (grid.size[0] - 4) * grid.res,
    (grid.size[1] - 4) * grid.res,
    (grid.size[2] - 4) * grid.res,
  );
  grid = makeSharedGrid(soup, soup, { res: opts.res ?? maxDim / 128 });
  const occ = voxelizeSoup(soup, grid);
  let solidCount = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) solidCount++;
  if (solidCount === 0) throw new Error('fitInscribed: mesh voxelized to nothing');
  return { occ, grid, solidCount };
}

/** Largest inscribed axis-aligned box. */
export function fitInscribedBox(soup: TriangleSoup, opts: InscribedOptions = {}): InscribedBox {
  const { occ, grid, solidCount } = buildOccupancy(soup, opts);
  const [nx, ny, nz] = grid.size;
  const idx3 = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // 3D DP: cube[i,j,k] = side (in voxels) of the largest solid cube whose
  // max-corner is (i,j,k).
  const cube = new Int32Array(nx * ny * nz);
  let bestSide = 0;
  let bestAt: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = idx3(i, j, k);
        if (!occ[id]) continue;
        let s = 1;
        if (i > 0 && j > 0 && k > 0) {
          s =
            1 +
            Math.min(
              cube[idx3(i - 1, j, k)], cube[idx3(i, j - 1, k)], cube[idx3(i, j, k - 1)],
              cube[idx3(i - 1, j - 1, k)], cube[idx3(i - 1, j, k - 1)], cube[idx3(i, j - 1, k - 1)],
              cube[idx3(i - 1, j - 1, k - 1)],
            );
        }
        cube[id] = s;
        if (s > bestSide) {
          bestSide = s;
          bestAt = [i, j, k];
        }
      }
    }
  }
  if (bestSide === 0) throw new Error('fitInscribedBox: no interior voxels');

  // Box in voxel index ranges [i0..i1] etc. (inclusive), seeded from the cube.
  let i1 = bestAt[0], j1 = bestAt[1], k1 = bestAt[2];
  let i0 = i1 - bestSide + 1, j0 = j1 - bestSide + 1, k0 = k1 - bestSide + 1;

  const solidRange = (ai: number, bi: number, aj: number, bj: number, ak: number, bk: number): boolean => {
    if (ai < 0 || aj < 0 || ak < 0 || bi >= nx || bj >= ny || bk >= nz) return false;
    for (let k = ak; k <= bk; k++) {
      for (let j = aj; j <= bj; j++) {
        for (let i = ai; i <= bi; i++) {
          if (!occ[idx3(i, j, k)]) return false;
        }
      }
    }
    return true;
  };

  // Greedy extension, round-robin over the six faces until none can grow.
  let grew = true;
  while (grew) {
    grew = false;
    if (solidRange(i0 - 1, i0 - 1, j0, j1, k0, k1)) { i0--; grew = true; }
    if (solidRange(i1 + 1, i1 + 1, j0, j1, k0, k1)) { i1++; grew = true; }
    if (solidRange(i0, i1, j0 - 1, j0 - 1, k0, k1)) { j0--; grew = true; }
    if (solidRange(i0, i1, j1 + 1, j1 + 1, k0, k1)) { j1++; grew = true; }
    if (solidRange(i0, i1, j0, j1, k0 - 1, k0 - 1)) { k0--; grew = true; }
    if (solidRange(i0, i1, j0, j1, k1 + 1, k1 + 1)) { k1++; grew = true; }
  }

  const res = grid.res;
  const min = [grid.min[0] + i0 * res, grid.min[1] + j0 * res, grid.min[2] + k0 * res];
  const max = [grid.min[0] + (i1 + 1) * res, grid.min[1] + (j1 + 1) * res, grid.min[2] + (k1 + 1) * res];
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const volume = size[0] * size[1] * size[2];
  return {
    kind: 'box',
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size,
    volume,
    volumeFraction: volume / (solidCount * res ** 3),
  };
}

/** Felzenszwalb exact 2D squared Euclidean distance transform: dt[i] =
 *  squared distance from cell i to the nearest cell where mask is 0. */
function edt2d(mask: Uint8Array, out: Int32Array, nx: number, ny: number): void {
  const INF = 1e9;
  const f = new Float64Array(Math.max(nx, ny));
  const d = new Float64Array(Math.max(nx, ny));
  const v = new Int32Array(Math.max(nx, ny));
  const z = new Float64Array(Math.max(nx, ny) + 1);

  const edt1d = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  // Pass 1: per column (along y).
  const tmp = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = mask[j * nx + i] ? INF : 0;
    edt1d(ny);
    for (let j = 0; j < ny; j++) tmp[j * nx + i] = d[j];
  }
  // Pass 2: per row (along x).
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = tmp[j * nx + i];
    edt1d(nx);
    for (let i = 0; i < nx; i++) out[j * nx + i] = Math.round(d[i]);
  }
}

/** Largest inscribed Z-axis cylinder (coarse candidate Z-ranges). */
export function fitInscribedCylinder(soup: TriangleSoup, opts: InscribedOptions = {}): InscribedCylinder {
  const { occ, grid, solidCount } = buildOccupancy(soup, opts);
  const [nx, ny, nz] = grid.size;
  const res = grid.res;
  const idx3 = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  // Candidate Z-ranges from ~9 evenly spaced cut planes (36 ranges).
  const cuts: number[] = [];
  const nCuts = Math.min(9, nz);
  for (let c = 0; c < nCuts; c++) cuts.push(Math.round((c * (nz - 1)) / Math.max(1, nCuts - 1)));

  let best: InscribedCylinder | null = null;
  const and2d = new Uint8Array(nx * ny);
  const dt = new Int32Array(nx * ny);

  for (let a = 0; a < cuts.length; a++) {
    for (let b = a; b < cuts.length; b++) {
      const k0 = cuts[a], k1 = cuts[b];
      // AND-map: column (i,j) solid across the whole [k0..k1] range.
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          let solid = 1;
          for (let k = k0; k <= k1; k++) {
            if (!occ[idx3(i, j, k)]) { solid = 0; break; }
          }
          and2d[j * nx + i] = solid;
        }
      }
      // Exact Euclidean distance transform (squared) to the nearest empty
      // cell — chessboard under-reports a disc's radius by ~30% (diagonal
      // steps count as 1), so an inscribed CIRCLE needs the L2 metric.
      edt2d(and2d, dt, nx, ny);
      let bestD2 = 0, bestI = 0, bestJ = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const id = j * nx + i;
          if (and2d[id] && dt[id] > bestD2) { bestD2 = dt[id]; bestI = i; bestJ = j; }
        }
      }
      if (bestD2 === 0) continue;
      const rVox = Math.sqrt(bestD2) - 0.5;
      // Greedily extend the range past the coarse cut planes while every
      // voxel of the disc stays solid at the next layer.
      const discSolidAt = (k: number): boolean => {
        if (k < 0 || k >= nz) return false;
        const rCeil = Math.ceil(rVox);
        for (let dj = -rCeil; dj <= rCeil; dj++) {
          for (let di = -rCeil; di <= rCeil; di++) {
            if (di * di + dj * dj > rVox * rVox) continue;
            const ii = bestI + di, jj = bestJ + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || !occ[idx3(ii, jj, k)]) return false;
          }
        }
        return true;
      };
      let ek0 = k0, ek1 = k1;
      while (discSolidAt(ek0 - 1)) ek0--;
      while (discSolidAt(ek1 + 1)) ek1++;
      const r = rVox * res;
      const h = (ek1 - ek0 + 1) * res;
      const volume = Math.PI * r * r * h;
      if (!best || volume > best.volume) {
        best = {
          kind: 'cylinder',
          center: [grid.min[0] + (bestI + 0.5) * res, grid.min[1] + (bestJ + 0.5) * res],
          r,
          z0: grid.min[2] + ek0 * res,
          z1: grid.min[2] + (ek1 + 1) * res,
          volume,
          volumeFraction: volume / (solidCount * res ** 3),
        };
      }
    }
  }
  if (!best) throw new Error('fitInscribedCylinder: no inscribed cylinder found');
  return best;
}
