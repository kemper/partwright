// Edit-locality check for two versions of a model (#1093): how far did each
// surface move, where, and which parts were left alone? The answer to "did my
// edit only touch the head?" without eyeballing renders.
//
// Every vertex plus an area-spread grid of surface points of each mesh is
// measured against the OTHER mesh's surface (true point-to-triangle distance via the BVH in
// colorTransfer.ts), so both added geometry (B far from A) and removed
// geometry (A far from B) register. Pure (no WASM, no DOM) and unit-tested;
// `diffVersions` in main.ts runs the two versions and calls this.

import { nearestSurfaceTriangleMap } from '../surface/colorTransfer';
import type { MeshData } from './types';

type Vec3 = [number, number, number];

export interface PartDeviation {
  name: string;
  /** Largest distance any point of this part moved (either direction). */
  maxDisplacement: number;
  /** Share of the part's surface (before and after together) that moved past
   *  tolerance — small when only a seam it shares with an edited part moved. */
  changedFraction: number;
  changed: boolean;
  /** 'both' normally; 'a' when the part only exists in A (removed), 'b' when
   *  it only exists in B (added). */
  in: 'both' | 'a' | 'b';
}

export interface MeshDiffReport {
  /** Distances at or below this count as unchanged. */
  tolerance: number;
  /** Largest point-to-surface distance in either direction (a Hausdorff
   *  estimate over vertices + area-spread surface samples). */
  maxDisplacement: number;
  /** Mean over every measured point of both meshes. */
  meanDisplacement: number;
  /** Fraction of B's surface area whose triangles moved past tolerance. */
  changedFraction: number;
  /** Box around every point that moved past tolerance (in A or B), or null. */
  changedBox: { min: Vec3; max: Vec3 } | null;
  /** Per labelled part (by name, from either version). */
  parts: PartDeviation[];
}

/** Sample points per mesh (spread by area) for the distance measurement. */
const TARGET_SAMPLES = 20000;

/** Distance from each triangle of `mesh` to the `other` surface, measured at
 *  its three vertices plus an area-proportional grid of interior points (so a
 *  long sliver of a triangle is judged along its length, not by its corners).
 *  Per triangle: the largest distance (for max / heatmap) and the area that
 *  moved past `tol`. Grows `box` around every moved point. */
function triangleDeviation(mesh: MeshData, other: MeshData, box: { min: Vec3; max: Vec3 }, tol: number): { perTri: Float32Array; movedArea: Float32Array; area: Float32Array; sum: number; count: number } {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  const nv = vp.length / np;
  const nt = tv.length / 3;
  const area = new Float32Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) { area[t] = triArea(mesh, t); total += area[t]; }
  const per = total / TARGET_SAMPLES;
  // Each triangle gets an n×n grid of sub-triangle centroids (n ≥ 1).
  const grid = new Int32Array(nt);
  let ns = 0;
  for (let t = 0; t < nt; t++) {
    grid[t] = per > 0 ? Math.min(8, Math.max(1, Math.ceil(Math.sqrt(area[t] / per)))) : 1;
    ns += grid[t] * grid[t];
  }
  const pts = new Float64Array((nv + ns) * 3);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) pts[v * 3 + k] = vp[v * np + k];
  let q = nv;
  for (let t = 0; t < nt; t++) {
    const n = grid[t];
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    // Centroids of the n² sub-triangles of a uniform barycentric split.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const cents = [[i + 1 / 3, j + 1 / 3]];
        if (j < n - i - 1) cents.push([i + 2 / 3, j + 2 / 3]);
        for (const [u0, v0] of cents) {
          const u = u0 / n, w = v0 / n, s = 1 - u - w;
          for (let k = 0; k < 3; k++) pts[q * 3 + k] = vp[a + k] * s + vp[b + k] * u + vp[c + k] * w;
          q++;
        }
      }
    }
  }
  const d = new Float64Array(nv + ns);
  if (other.numTri > 0) nearestSurfaceTriangleMap(other, pts, d);
  else d.fill(Infinity);
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.sqrt(d[i]);
    sum += Number.isFinite(d[i]) ? d[i] : 0;
    if (d[i] > tol) {
      for (let k = 0; k < 3; k++) {
        if (pts[i * 3 + k] < box.min[k]) box.min[k] = pts[i * 3 + k];
        if (pts[i * 3 + k] > box.max[k]) box.max[k] = pts[i * 3 + k];
      }
    }
  }
  const perTri = new Float32Array(nt);
  const movedArea = new Float32Array(nt);
  q = nv;
  for (let t = 0; t < nt; t++) {
    const m = grid[t] * grid[t];
    let mx = Math.max(d[tv[t * 3]], d[tv[t * 3 + 1]], d[tv[t * 3 + 2]]);
    let moved = 0;
    for (let s = 0; s < m; s++, q++) {
      if (d[q] > mx) mx = d[q];
      if (d[q] > tol) moved++;
    }
    perTri[t] = mx;
    movedArea[t] = (area[t] * moved) / m;
  }
  return { perTri, movedArea, area, sum, count: d.length };
}

function diagonal(mesh: MeshData): number {
  const { vertProperties: vp, numProp: np } = mesh;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vp.length; i += np) {
    for (let k = 0; k < 3; k++) { if (vp[i + k] < lo[k]) lo[k] = vp[i + k]; if (vp[i + k] > hi[k]) hi[k] = vp[i + k]; }
  }
  return lo[0] <= hi[0] ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
}

function triArea(mesh: MeshData, t: number): number {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
  const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
  const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Compare mesh `b` (after) against mesh `a` (before). `labelsA` / `labelsB`
 *  map part names to triangle indices (the run's labelMap). `tolerance`
 *  defaults to 1e-4 of B's bounding-box diagonal. Also returns B's
 *  per-triangle deviation for a heatmap. */
export function meshDiff(
  a: MeshData,
  b: MeshData,
  opts: { tolerance?: number; labelsA?: Map<string, Set<number>> | null; labelsB?: Map<string, Set<number>> | null } = {},
): { report: MeshDiffReport; perTriB: Float32Array } {
  const tol = opts.tolerance ?? 1e-4 * Math.max(diagonal(b), diagonal(a), 1e-9);
  const box = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
  const devA = triangleDeviation(a, b, box, tol);
  const devB = triangleDeviation(b, a, box, tol);

  let max = 0;
  for (const p of [devA.perTri, devB.perTri]) for (let i = 0; i < p.length; i++) if (p[i] > max) max = p[i];
  let areaAll = 0, areaChanged = 0;
  for (let i = 0; i < devB.area.length; i++) { areaAll += devB.area[i]; areaChanged += devB.movedArea[i]; }

  const names = new Set<string>([...(opts.labelsA?.keys() ?? []), ...(opts.labelsB?.keys() ?? [])]);
  const parts: PartDeviation[] = [];
  for (const name of [...names].sort()) {
    const ta = opts.labelsA?.get(name), tb = opts.labelsB?.get(name);
    const hasA = !!ta && ta.size > 0, hasB = !!tb && tb.size > 0;
    let m = 0, area = 0, moved = 0;
    const tally = (tris: Set<number> | undefined, dev: typeof devA) => {
      if (!tris) return;
      for (const t of tris) {
        if (dev.perTri[t] > m) m = dev.perTri[t];
        area += dev.area[t];
        moved += dev.movedArea[t];
      }
    };
    tally(ta, devA);
    tally(tb, devB);
    parts.push({
      name,
      maxDisplacement: m,
      changedFraction: area > 0 ? moved / area : 0,
      changed: !(hasA && hasB) || m > tol,
      in: hasA && hasB ? 'both' : hasA ? 'a' : 'b',
    });
  }

  return {
    report: {
      tolerance: tol,
      maxDisplacement: max,
      meanDisplacement: (devA.sum + devB.sum) / Math.max(1, devA.count + devB.count),
      changedFraction: areaAll > 0 ? areaChanged / areaAll : 0,
      changedBox: box.min[0] <= box.max[0] ? box : null,
      parts,
    },
    perTriB: devB.perTri,
  };
}

/** Per-triangle heatmap colours for a deviation field: neutral grey at or
 *  below `tolerance`, then yellow → red as the distance approaches `max`. */
export function deviationColors(perTri: Float32Array, tolerance: number, max: number): Uint8Array {
  const out = new Uint8Array(perTri.length * 3);
  const span = Math.max(max - tolerance, 1e-12);
  for (let t = 0; t < perTri.length; t++) {
    const d = perTri[t];
    if (!(d > tolerance)) { out[t * 3] = 170; out[t * 3 + 1] = 172; out[t * 3 + 2] = 178; continue; }
    const s = Math.min(1, (d - tolerance) / span);
    out[t * 3] = 235;
    out[t * 3 + 1] = Math.round(205 * (1 - s) + 40 * s);
    out[t * 3 + 2] = Math.round(60 * (1 - s) + 30 * s);
  }
  return out;
}
