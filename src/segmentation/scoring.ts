// Pure scoring helpers for the part-detection benchmark (segment:bench):
// ground-truth seed placement, partition-vs-truth IoU, and scan-like jitter.
// Kept dependency-free so the unit tier can test them without WASM.

import { nearestTriangle } from './features';
import type { MeshFeatures, SegMesh, SegSeed } from './types';

/** One seed per true label, on the label's triangle nearest its area-weighted
 *  centroid — a stand-in for "a person clicked on the middle of each part". */
export function seedsFromTruth(f: MeshFeatures, truth: Int32Array, names: string[]): SegSeed[] {
  const n = names.length;
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n), sa = new Float64Array(n);
  for (let t = 0; t < truth.length; t++) {
    const L = truth[t];
    if (L < 0) continue;
    const a = f.triArea[t];
    sx[L] += f.triCentroid[t * 3] * a; sy[L] += f.triCentroid[t * 3 + 1] * a; sz[L] += f.triCentroid[t * 3 + 2] * a; sa[L] += a;
  }
  const seeds: SegSeed[] = [];
  for (let L = 0; L < n; L++) {
    if (sa[L] === 0) continue;
    const c: [number, number, number] = [sx[L] / sa[L], sy[L] / sa[L], sz[L] / sa[L]];
    const t = nearestTriangle(f, c, (x) => truth[x] === L);
    seeds.push({ label: names[L], point: [f.triCentroid[t * 3], f.triCentroid[t * 3 + 1], f.triCentroid[t * 3 + 2]], triangle: t });
  }
  return seeds;
}

/** Area-weighted best-match IoU of a predicted partition against the truth:
 *  for every true label, the IoU with the predicted part that overlaps it
 *  best, weighted by the label's area. 1 = perfect. */
export function scorePartition(pred: Int32Array, truth: Int32Array, area: Float32Array): { iou: number; perLabel: number[] } {
  const nT = maxOf(truth) + 1;
  const nP = maxOf(pred) + 1;
  const inter = new Float64Array(nT * Math.max(1, nP));
  const aT = new Float64Array(nT), aP = new Float64Array(Math.max(1, nP));
  for (let t = 0; t < truth.length; t++) {
    const g = truth[t], p = pred[t], a = area[t];
    if (g >= 0) aT[g] += a;
    if (p >= 0) aP[p] += a;
    if (g >= 0 && p >= 0) inter[g * nP + p] += a;
  }
  const perLabel: number[] = [];
  let num = 0, den = 0;
  for (let g = 0; g < nT; g++) {
    let best = 0;
    for (let p = 0; p < nP; p++) {
      const i = inter[g * nP + p];
      const u = aT[g] + aP[p] - i;
      if (u > 0 && i / u > best) best = i / u;
    }
    perLabel.push(best);
    num += best * aT[g];
    den += aT[g];
  }
  return { iou: den > 0 ? num / den : 0, perLabel };
}

/** Scan-like copy of a mesh: every vertex jittered by up to `amount`
 *  (world units) along a random direction, deterministically. The bench uses
 *  it so detectors are also scored on noisy, scan-like surfaces. */
export function jitterMesh(mesh: SegMesh, amount: number, seed = 1): SegMesh {
  let x = seed >>> 0 || 1;
  const rand = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0xffffffff; };
  const positions = Float32Array.from(mesh.positions);
  for (let i = 0; i < positions.length; i++) positions[i] += (rand() * 2 - 1) * amount;
  return { positions, triVerts: mesh.triVerts };
}

/** Max of a large typed array (spread would blow the call stack). */
function maxOf(a: Int32Array): number {
  let m = -1;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}
