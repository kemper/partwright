// `auto-merge` — "Auto patches": a seedless detector for the "just name and
// merge" workflow.
//
//   1. Over-segment: drop one seed per grid cell (cell = patchSizePct of the
//      model's diagonal) and grow them with crease-weighted path cost, so the
//      small patches' borders snap onto grooves.
//   2. Merge: rank every patch-to-patch border by its length-weighted mean
//      concave-crease strength and union borders weaker than mergeBelowDeg —
//      faint folds dissolve, real grooves survive as part boundaries.
//   3. Absorb specks below minPatchPct of the surface.
//
// Step 1 is the expensive part (~0.5 s on a 460k-triangle scan) and depends
// only on (features, patch size, allowed area), so it is cached in the
// runner's per-mesh cache: dragging the Finer ↔ Coarser slider only re-runs
// steps 2–3 (tens of ms). Prototype numbers on the test figurine (2.5 mm
// cells, 4° merge): eyes, brows, nose, ears, both arms incl. their hidden
// inner sides, ball, shirt, shorts, socks and shoes came out as separate
// patches; hair + face stayed merged (the sideburn has no groove).

import { absorbSmallRegions, adjacencyFromPairs } from '../geometry/triSetOps';
import { featureOptionsKey, maskKey } from './features';
import { growFromSeeds } from './growth';
import type { DetectorResult, MeshFeatures, PartDetector } from './types';

interface Oversegmentation {
  /** Patch id per triangle (−1 where not allowed / unreached). */
  patch: Int32Array;
  patchCount: number;
  /** Patch borders, weakest first. */
  borderA: Int32Array;
  borderB: Int32Array;
  borderStrength: Float32Array;
}

function oversegment(f: MeshFeatures, cell: number, allow: Uint8Array | undefined): Oversegmentation {
  // One seed per occupied grid cell: the allowed triangle nearest the cell centre.
  const n = f.triCount, c = f.triCentroid;
  const best = new Map<string, { t: number; d: number }>();
  for (let t = 0; t < n; t++) {
    if (allow && !allow[t]) continue;
    const ix = Math.floor(c[t * 3] / cell), iy = Math.floor(c[t * 3 + 1] / cell), iz = Math.floor(c[t * 3 + 2] / cell);
    const key = `${ix},${iy},${iz}`;
    const dx = c[t * 3] - (ix + 0.5) * cell, dy = c[t * 3 + 1] - (iy + 0.5) * cell, dz = c[t * 3 + 2] - (iz + 0.5) * cell;
    const d = dx * dx + dy * dy + dz * dz;
    const cur = best.get(key);
    if (!cur || d < cur.d) best.set(key, { t, d });
  }
  const seeds = Int32Array.from([...best.values()].map((v) => v.t));
  const labels = Int32Array.from(seeds.keys());
  // Separate pieces with no seed in them (tiny loose bits) still need a patch.
  const g = growFromSeeds(f, seeds, labels, { growth: 'summed', creaseQuantumDeg: 1, creaseWeight: 1, allow });
  let patchCount = seeds.length;
  const patch = g.triLabel;
  // One extra seed per piece that no grid seed reached, grown in one pass.
  const extraSeeds: number[] = [], extraLabels: number[] = [];
  const seededPiece = new Set<number>();
  for (let t = 0; t < n; t++) {
    if (patch[t] >= 0 || (allow && !allow[t]) || seededPiece.has(f.pieceOfTri[t])) continue;
    seededPiece.add(f.pieceOfTri[t]);
    extraSeeds.push(t);
    extraLabels.push(patchCount++);
  }
  if (extraSeeds.length) {
    const unreached = new Uint8Array(n);
    for (let t = 0; t < n; t++) if (patch[t] < 0 && (!allow || allow[t])) unreached[t] = 1;
    const extra = growFromSeeds(f, extraSeeds, extraLabels, { growth: 'summed', creaseQuantumDeg: 1, creaseWeight: 1, allow: unreached });
    for (let t = 0; t < n; t++) if (unreached[t] && extra.triLabel[t] >= 0) patch[t] = extra.triLabel[t];
  }
  // Borders: length-weighted mean crease per adjacent patch pair.
  const sumLen = new Map<number, number>(), sumCrease = new Map<number, number>();
  for (let e = 0; e < f.edgeA.length; e++) {
    const a = patch[f.edgeA[e]], b = patch[f.edgeB[e]];
    if (a === b || a < 0 || b < 0) continue;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * patchCount + hi;
    sumLen.set(key, (sumLen.get(key) ?? 0) + f.edgeLen[e]);
    sumCrease.set(key, (sumCrease.get(key) ?? 0) + f.creaseCost[e] * f.edgeLen[e]);
  }
  const keys = [...sumLen.keys()];
  const strength = keys.map((k) => sumCrease.get(k)! / Math.max(1e-12, sumLen.get(k)!));
  const order = keys.map((_, i) => i).sort((i, j) => strength[i] - strength[j]);
  return {
    patch, patchCount,
    borderA: Int32Array.from(order.map((i) => Math.floor(keys[i] / patchCount))),
    borderB: Int32Array.from(order.map((i) => keys[i] % patchCount)),
    borderStrength: Float32Array.from(order.map((i) => strength[i])),
  };
}

export const autoMergeDetector: PartDetector = {
  id: 'auto-merge',
  name: 'Auto patches',
  description: 'No seeds needed: splits the surface into patches along its grooves. Name a patch to label it; give two patches the same name to merge them. Finer ↔ Coarser (merge threshold) is instant to adjust.',
  bestFor: 'A quick first pass on any fused sculpt or scan — then name, merge, or convert the patches to seeds for refinement.',
  seeds: 'none',
  params: [
    {
      key: 'mergeBelowDeg', label: 'Finer ↔ Coarser', type: 'number', default: 4, min: 0.5, max: 40, step: 0.5,
      hint: 'Patch borders whose average groove is shallower than this many degrees dissolve. Higher = fewer, bigger patches (coarser); lower = more, smaller patches (finer).',
    },
    {
      key: 'patchSizePct', label: 'Patch size (%)', type: 'number', default: 1.5, min: 0.3, max: 10, step: 0.1,
      hint: 'Starting patch size as a percentage of the model\'s diagonal. Smaller finds smaller features (pupils, buttons) but takes longer the first time.',
    },
    {
      key: 'minPatchPct', label: 'Absorb below (%)', type: 'number', default: 0.02, min: 0, max: 5, step: 0.01,
      hint: 'Patches smaller than this percentage of the surface are folded into their neighbour.',
    },
  ],
  presets: [
    { name: 'Balanced', params: {} },
    { name: 'Coarse', params: { mergeBelowDeg: 10 } },
    { name: 'Very coarse', params: { mergeBelowDeg: 20 } },
    { name: 'Fine', params: { mergeBelowDeg: 2 } },
    { name: 'Small features', params: { patchSizePct: 0.8, mergeBelowDeg: 3 } },
    { name: 'Big blocks', params: { patchSizePct: 3, mergeBelowDeg: 8 } },
  ],
  run(_mesh, f, ctx): DetectorResult {
    const diag = Math.hypot(...bboxSize(f));
    const cell = Math.max(f.medianEdgeLen * 2, (Number(ctx.params.patchSizePct) / 100) * diag);
    const key = `auto-merge:${featureOptionsKey(f.options)}:${cell.toPrecision(6)}:${maskKey(ctx.allow)}`;
    let seg = ctx.cache?.get(key) as Oversegmentation | undefined;
    if (!seg) {
      ctx.progress?.(0.05, 'Forming patches…');
      seg = oversegment(f, cell, ctx.allow);
      ctx.cache?.set(key, seg);
    }
    ctx.progress?.(0.8, 'Merging patches…');
    // Union borders weaker than the threshold.
    const parent = Int32Array.from({ length: seg.patchCount }, (_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const thr = Number(ctx.params.mergeBelowDeg);
    for (let i = 0; i < seg.borderStrength.length && seg.borderStrength[i] < thr; i++) {
      const a = find(seg.borderA[i]), b = find(seg.borderB[i]);
      if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
    }
    const triPart = new Int32Array(f.triCount);
    for (let t = 0; t < f.triCount; t++) triPart[t] = seg.patch[t] < 0 ? -1 : find(seg.patch[t]);
    // Absorb specks, then number patches by area (largest first).
    const minArea = (Number(ctx.params.minPatchPct) / 100) * f.totalArea;
    if (minArea > 0) {
      absorbSmallRegions(triPart, adjacencyFromPairs(f.triCount, f.edgeA, f.edgeB), f.triArea, minArea);
      // Absorption may have pulled unassigned or outside triangles in — keep
      // the allow contract.
      if (ctx.allow) for (let t = 0; t < f.triCount; t++) if (!ctx.allow[t]) triPart[t] = -1;
    }
    const area = new Map<number, number>();
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) area.set(triPart[t], (area.get(triPart[t]) ?? 0) + f.triArea[t]);
    const order = [...area.keys()].sort((x, y) => area.get(y)! - area.get(x)!);
    const remap = new Map(order.map((r, i) => [r, i] as const));
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) triPart[t] = remap.get(triPart[t])!;
    return {
      triPart,
      partNames: order.map((_, i) => `patch ${i + 1}`),
      genericNames: true,
      diagnostics: { initialPatches: seg.patchCount, patches: order.length },
    };
  },
};

function bboxSize(f: MeshFeatures): [number, number, number] {
  const c = f.triCentroid;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < c.length; i += 3) for (let d = 0; d < 3; d++) {
    if (c[i + d] < min[d]) min[d] = c[i + d];
    if (c[i + d] > max[d]) max[d] = c[i + d];
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}
