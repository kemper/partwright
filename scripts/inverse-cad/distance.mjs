// Mesh-to-mesh distance metrics. All operate on point-cloud samples of
// each mesh's surface; the k-d tree makes each nearest-neighbor query O(log n).
//
// Chamfer  = mean over both directions of nearest-neighbor distance
// Hausdorff = max over both directions of nearest-neighbor distance
// residuals = per-point signed-ish distance (raw nearest-neighbor from candidate → target)
//
// Both meshes should be at the same scale and translation. The invariants
// step (bbox+PCA align) is a separate module; distance itself does no fitting.

import { samplePoints, buildKdTree } from './sampleMesh.mjs';

function nnDistances(pointsA, kdB) {
  const n = pointsA.length / 3;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { distSq } = kdB.nearest(pointsA[i * 3], pointsA[i * 3 + 1], pointsA[i * 3 + 2]);
    out[i] = Math.sqrt(distSq);
  }
  return out;
}

function stats(arr) {
  let sum = 0, sumSq = 0, max = 0;
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    sum += v;
    sumSq += v * v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, rms: Math.sqrt(sumSq / n), std: Math.sqrt(variance), max };
}

function quantile(arr, q) {
  const sorted = Float64Array.from(arr);
  sorted.sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

// Score `candidate` vs `target`. Both are { triangles: Float32Array }.
export function meshDistance(target, candidate, opts = {}) {
  const nSamples = opts.samples ?? 5000;
  const seed = opts.seed ?? 1;
  const targetPts = samplePoints(target, nSamples, { seed });
  const candPts = samplePoints(candidate, nSamples, { seed: seed + 1 });
  const kdTarget = buildKdTree(targetPts);
  const kdCand = buildKdTree(candPts);
  const dCandToTarget = nnDistances(candPts, kdTarget);
  const dTargetToCand = nnDistances(targetPts, kdCand);
  const a = stats(dCandToTarget);
  const b = stats(dTargetToCand);
  return {
    samples: nSamples,
    chamfer: 0.5 * (a.mean + b.mean),
    hausdorff: Math.max(a.max, b.max),
    rms: Math.sqrt(0.5 * (a.rms * a.rms + b.rms * b.rms)),
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
