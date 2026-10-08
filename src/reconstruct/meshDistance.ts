// Mesh-to-mesh distance metrics over point-cloud surface samples. Ported
// from scripts/inverse-cad/distance.mjs (the sampled variant — the exact
// BVH point-to-surface method stays headless-only for now; the sampled
// metrics carry a small noise floor proportional to sample spacing, which
// the report surfaces as `sampleSpacing`).
//
// Chamfer   = mean over both directions of nearest-neighbor distance
// Hausdorff = max over both directions of nearest-neighbor distance
//
// Both meshes must share scale and translation; no fitting happens here.

import type { TriangleSoup } from './slice2d';
import { samplePoints, buildKdTree, triAreas } from './sampleMesh';

export interface DirectionalStats {
  mean: number;
  rms: number;
  max: number;
  p50: number;
  p90: number;
  p99: number;
}

export interface MeshDistanceReport {
  samples: number;
  chamfer: number;
  hausdorff: number;
  rms: number;
  /** Mean spacing between surface samples — distances below this are noise. */
  sampleSpacing: number;
  candToTarget: DirectionalStats;
  targetToCand: DirectionalStats;
}

function nnDistances(pointsA: Float32Array, kdB: ReturnType<typeof buildKdTree>): Float64Array {
  const n = pointsA.length / 3;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { distSq } = kdB.nearest(pointsA[i * 3], pointsA[i * 3 + 1], pointsA[i * 3 + 2]);
    out[i] = Math.sqrt(distSq);
  }
  return out;
}

function stats(arr: Float64Array): { mean: number; rms: number; max: number } {
  let sum = 0,
    sumSq = 0,
    max = 0;
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    sum += v;
    sumSq += v * v;
    if (v > max) max = v;
  }
  return { mean: sum / n, rms: Math.sqrt(sumSq / n), max };
}

function quantile(arr: Float64Array, q: number): number {
  const sorted = Float64Array.from(arr);
  sorted.sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

/** Score `candidate` vs `target` (both triangle soups at the same pose). */
export function meshDistance(
  target: TriangleSoup,
  candidate: TriangleSoup,
  opts: { samples?: number; seed?: number } = {},
): MeshDistanceReport {
  const nSamples = opts.samples ?? 4000;
  const seed = opts.seed ?? 1;
  const targetPts = samplePoints(target, nSamples, { seed });
  const candPts = samplePoints(candidate, nSamples, { seed: seed + 1 });
  const kdTarget = buildKdTree(targetPts);
  const kdCand = buildKdTree(candPts);
  const dCandToTarget = nnDistances(candPts, kdTarget);
  const dTargetToCand = nnDistances(targetPts, kdCand);
  const a = stats(dCandToTarget);
  const b = stats(dTargetToCand);
  const { total } = triAreas(target.triangles);
  return {
    samples: nSamples,
    chamfer: 0.5 * (a.mean + b.mean),
    hausdorff: Math.max(a.max, b.max),
    rms: Math.sqrt(0.5 * (a.rms * a.rms + b.rms * b.rms)),
    sampleSpacing: Math.sqrt(total / nSamples),
    candToTarget: {
      mean: a.mean, rms: a.rms, max: a.max,
      p50: quantile(dCandToTarget, 0.5),
      p90: quantile(dCandToTarget, 0.9),
      p99: quantile(dCandToTarget, 0.99),
    },
    targetToCand: {
      mean: b.mean, rms: b.rms, max: b.max,
      p50: quantile(dTargetToCand, 0.5),
      p90: quantile(dTargetToCand, 0.9),
      p99: quantile(dTargetToCand, 0.99),
    },
  };
}
