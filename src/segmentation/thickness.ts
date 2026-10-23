// `thickness` — "Thickness (limbs vs body)": split parts where NO groove
// exists, using how thick the solid is under each triangle. Arms and legs are
// thin, the torso medium, the head and a held ball thick.
//
// This is the shape-diameter-function idea (Shapira et al. 2008) computed from
// a voxel distance field instead of ray cones, because that infrastructure
// already exists (`meshSdf.ts`) and is fast:
//
//   1. Voxelize the solid (scanline parity) and run an exact EDT so every
//      inside voxel knows its distance R to the nearest outside voxel — the
//      radius of the biggest ball that fits there.
//   2. For each triangle, march inward along −normal and take the maximum R
//      seen before the medial axis is passed: the local half-thickness. Four
//      more rays in a 25° cone around −normal and a median of the five make it
//      robust to a bumpy normal (the SDF paper's trick).
//   3. Work in log space (a 10% thickness jump is the same step on a finger as
//      on a torso) and smooth with an edge-preserving bilateral average over
//      the triangle adjacency, so a limb/torso jump survives while scan noise
//      dies.
//   4a. No seeds: cluster ln(thickness) into `levels` classes (1-D k-means),
//       take connected components of each class as parts, absorb specks.
//   4b. Seeds: grow them with the usual hybrid crease-watershed, but with the
//       thickness jump added to the crease cost of every edge — boundaries
//       settle where the solid changes thickness AND/OR a groove exists.
//
// Stage 1 is the expensive one and depends only on (features, resolution,
// allowed area), so it is cached in the runner's per-mesh cache; the
// smoothing / level sliders re-run only the cheap stages.

import { absorbSmallRegions, adjacencyFromPairs } from '../geometry/triSetOps';
import { edt3dSquared, rasterizeOccupancy, type GridSpec } from '../geometry/meshSdf';
import { featureOptionsKey, maskKey } from './features';
import { resolveSeeds } from './detectors';
import { AbortedError, growFromSeeds, vertexCostField } from './growth';
import type { DetectorResult, MeshFeatures, PartDetector, SegMesh } from './types';

/** Marching step along a ray, in voxels. */
const STEP_VOXELS = 0.5;
/** Stop marching once R falls below this fraction of the maximum seen (the
 *  ray has passed the medial axis). */
const PAST_AXIS_FRAC = 0.7;
/** A ray starts on the surface, where the sampled radius can still be 0 (the
 *  surface sits up to a voxel from the nearest inside centre); if it has not
 *  entered the solid after this many voxels it is pointing outward — a cone
 *  ray tilted off an edge — and must not wander out and re-enter elsewhere. */
const ENTER_GRACE_VOXELS = 1.5;
/** Stop once the ray has travelled this many times its best inside radius. */
const TRAVEL_FACTOR = 2;
/** Half-angle of the extra robustness rays around −normal. */
const CONE_RAD = (25 * Math.PI) / 180;
/** Bilateral smoothing bandwidth in ln(thickness): ~0.35 ≈ a 42% jump. */
const BILATERAL_SIGMA = 0.35;
const KMEANS_ITERATIONS = 20;
/** Rounds of speck absorption (a cascade of slivers needs more than the default 8). */
const ABSORB_ROUNDS = 64;

interface ThicknessField {
  /** ln(thickness) per triangle (0 where not allowed). Raw, unsmoothed. */
  logT: Float32Array;
  voxel: number;
  grid: [number, number, number];
  msVoxelize: number;
  msDistance: number;
  msMarch: number;
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortedError();
}

function computeThickness(
  mesh: SegMesh,
  f: MeshFeatures,
  resolution: number,
  allow: Uint8Array | undefined,
  signal: AbortSignal | undefined,
  progress: ((frac: number, msg?: string) => void) | undefined,
): ThicknessField {
  const n = f.triCount;
  const pos = mesh.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      if (pos[i + d] < min[d]) min[d] = pos[i + d];
      if (pos[i + d] > max[d]) max[d] = pos[i + d];
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(size[0], size[1], size[2]);
  if (!(longest > 0)) throw new Error('thickness: the mesh has no extent.');
  const voxel = longest / (resolution - 1);
  const pad = 2;
  const spec: GridSpec = {
    nx: Math.ceil(size[0] / voxel) + 1 + 2 * pad,
    ny: Math.ceil(size[1] / voxel) + 1 + 2 * pad,
    nz: Math.ceil(size[2] / voxel) + 1 + 2 * pad,
    origin: [min[0] - pad * voxel, min[1] - pad * voxel, min[2] - pad * voxel],
    voxel,
  };
  const { nx, ny, nz } = spec;
  const total = nx * ny * nz;

  // --- Voxelize + inside-radius field ----------------------------------------
  progress?.(0.02, 'Voxelizing…');
  let t0 = performance.now();
  const occ = rasterizeOccupancy({ vertProperties: pos, triVerts: mesh.triVerts, numProp: 3, numTri: n }, spec);
  let inside = 0;
  for (let i = 0; i < total; i++) inside += occ[i];
  if (inside === 0 || inside > total * 0.95) {
    throw new Error('thickness: the mesh did not voxelize into a sensible solid — it is probably not a closed (watertight) surface.');
  }
  const msVoxelize = performance.now() - t0;
  checkAbort(signal);

  progress?.(0.2, 'Measuring distance field…');
  t0 = performance.now();
  // Distance (voxels) from each inside voxel centre to the nearest outside
  // centre; the true surface is half a voxel closer, hence the −0.5 below.
  // Converted to the radius field in place: a second full-size array would
  // add ~4 bytes per voxel to the peak (≈70 MB at resolution 256).
  const radius = edt3dSquared((i) => occ[i] === 0, nx, ny, nz);
  for (let i = 0; i < total; i++) radius[i] = occ[i] ? Math.sqrt(radius[i]) * voxel : 0;
  const msDistance = performance.now() - t0;
  checkAbort(signal);

  // --- March from every allowed triangle -------------------------------------
  t0 = performance.now();
  const step = STEP_VOXELS * voxel;
  const maxDepth = 0.5 * Math.hypot(size[0], size[1], size[2]);
  const minT = voxel; // floor: a wall thinner than one voxel reads as one voxel
  const cosA = Math.cos(CONE_RAD), sinA = Math.sin(CONE_RAD);
  const nrm = f.smoothNormal, cen = f.triCentroid;
  const logT = new Float32Array(n);
  const ts = new Float64Array(5);
  const invVox = 1 / voxel;
  const [gx, gy, gz] = spec.origin;
  const strideY = nx, strideZ = nx * ny;

  /** Trilinear sample of the inside-radius field; 0 outside the lattice. */
  const sample = (x: number, y: number, z: number): number => {
    const fx = (x - gx) * invVox, fy = (y - gy) * invVox, fz = (z - gz) * invVox;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 0;
    const i0 = fx | 0, j0 = fy | 0, k0 = fz | 0;
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const b = i0 + j0 * strideY + k0 * strideZ;
    const c00 = radius[b] + (radius[b + 1] - radius[b]) * tx;
    const c10 = radius[b + strideY] + (radius[b + strideY + 1] - radius[b + strideY]) * tx;
    const c01 = radius[b + strideZ] + (radius[b + strideZ + 1] - radius[b + strideZ]) * tx;
    const c11 = radius[b + strideY + strideZ] + (radius[b + strideY + strideZ + 1] - radius[b + strideY + strideZ]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  };

  /** Half-thickness along one ray (origin ox,oy,oz; unit direction dx,dy,dz). */
  const march = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number => {
    let maxR = 0;
    let entered = false;
    for (let s = 0; s <= maxDepth; s += step) {
      const r = sample(ox + dx * s, oy + dy * s, oz + dz * s);
      if (r > maxR) maxR = r;
      if (r > 0) entered = true;
      else if (entered || s > ENTER_GRACE_VOXELS * voxel) break; // left the solid (or never went in)
      if (maxR >= voxel && r < PAST_AXIS_FRAC * maxR) break; // past the medial axis
      // R ≤ depth always, and a ray heading for the medial axis has R ≈ depth.
      // One that has gone much deeper than its best R is travelling ALONG a
      // limb (e.g. down a fingertip axis); anything it meets further on
      // (the torso it joins) is not this surface's thickness.
      if (s > TRAVEL_FACTOR * maxR + 2 * voxel) break;
    }
    return maxR;
  };

  const reportEvery = 8192;
  for (let t = 0; t < n; t++) {
    if (t % reportEvery === 0) {
      checkAbort(signal);
      progress?.(0.35 + 0.6 * (t / n), 'Measuring thickness…');
    }
    if (allow && !allow[t]) continue;
    let nx_ = nrm[t * 3], ny_ = nrm[t * 3 + 1], nz_ = nrm[t * 3 + 2];
    if (!(Math.hypot(nx_, ny_, nz_) > 0.5)) { nx_ = f.triNormal[t * 3]; ny_ = f.triNormal[t * 3 + 1]; nz_ = f.triNormal[t * 3 + 2]; }
    const dx = -nx_, dy = -ny_, dz = -nz_;
    const ox = cen[t * 3], oy = cen[t * 3 + 1], oz = cen[t * 3 + 2];
    ts[0] = march(ox, oy, oz, dx, dy, dz);
    // Orthonormal basis ⟂ d for the cone rays.
    let ux: number, uy: number, uz: number;
    if (Math.abs(dx) < 0.9) { ux = 0; uy = -dz; uz = dy; } else { ux = dz; uy = 0; uz = -dx; }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    for (let k = 0; k < 4; k++) {
      const ph = k * (Math.PI / 2);
      const cu = Math.cos(ph) * sinA, cv = Math.sin(ph) * sinA;
      ts[k + 1] = march(ox, oy, oz,
        dx * cosA + ux * cu + vx * cv,
        dy * cosA + uy * cu + vy * cv,
        dz * cosA + uz * cu + vz * cv);
    }
    // Median of five by insertion sort.
    for (let i = 1; i < 5; i++) {
      const v = ts[i];
      let j = i - 1;
      while (j >= 0 && ts[j] > v) { ts[j + 1] = ts[j]; j--; }
      ts[j + 1] = v;
    }
    const thick = Math.max(minT, 2 * (ts[2] - 0.5 * voxel));
    logT[t] = Math.log(thick);
  }
  const msMarch = performance.now() - t0;
  return { logT, voxel, grid: [nx, ny, nz], msVoxelize, msDistance, msMarch };
}

/** Edge-preserving smoothing of ln(thickness): each triangle becomes an
 *  area-weighted mean of itself and its neighbours, where a neighbour's weight
 *  falls off with how different its value is (bilateral). */
function smoothLogThickness(f: MeshFeatures, logT: Float32Array, iterations: number, allow: Uint8Array | undefined, signal: AbortSignal | undefined): Float32Array {
  let cur = Float32Array.from(logT);
  if (iterations <= 0) return cur;
  let next = new Float32Array(cur.length);
  const inv = 1 / (BILATERAL_SIGMA * BILATERAL_SIGMA);
  for (let it = 0; it < iterations; it++) {
    checkAbort(signal);
    for (let t = 0; t < f.triCount; t++) {
      if (allow && !allow[t]) { next[t] = cur[t]; continue; }
      const st = cur[t];
      let wSum = f.triArea[t], acc = f.triArea[t] * st;
      for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
        const e = f.adjPair[j];
        const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
        if (allow && !allow[o]) continue;
        const d = cur[o] - st;
        const w = f.triArea[o] * Math.exp(-d * d * inv);
        wSum += w; acc += w * cur[o];
      }
      next[t] = acc / wSum;
    }
    const tmp = cur; cur = next; next = tmp;
  }
  return cur;
}

/** Area-weighted 1-D k-means with quantile initialisation (deterministic).
 *  Returns ascending class centers and the class of every allowed triangle
 *  (−1 elsewhere). */
function kmeans1d(s: Float32Array, area: Float32Array, allow: Uint8Array | undefined, k: number): { centers: Float64Array; cls: Int32Array } {
  const n = s.length;
  const idx: number[] = [];
  for (let t = 0; t < n; t++) if (!allow || allow[t]) idx.push(t);
  idx.sort((a, b) => s[a] - s[b]);
  if (idx.length === 0) return { centers: new Float64Array(k), cls: new Int32Array(n).fill(-1) };
  let totalArea = 0;
  for (const t of idx) totalArea += area[t];
  const centers = new Float64Array(k);
  // Quantile init: the value at the area-weighted (i + 0.5) / k quantile.
  let c = 0, run = 0;
  for (const t of idx) {
    run += area[t];
    while (c < k && run >= ((c + 0.5) / k) * totalArea) centers[c++] = s[t];
  }
  while (c < k) centers[c++] = s[idx[idx.length - 1]];
  const cls = new Int32Array(n).fill(-1);
  const sum = new Float64Array(k), w = new Float64Array(k);
  for (let it = 0; it < KMEANS_ITERATIONS; it++) {
    sum.fill(0); w.fill(0);
    let changed = false;
    for (const t of idx) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = Math.abs(s[t] - centers[j]);
        if (d < bd) { bd = d; best = j; }
      }
      if (cls[t] !== best) { cls[t] = best; changed = true; }
      sum[best] += area[t] * s[t]; w[best] += area[t];
    }
    for (let j = 0; j < k; j++) if (w[j] > 0) centers[j] = sum[j] / w[j];
    if (!changed) break;
  }
  // Centers can cross when a class empties; relabel so rank 0 is the thinnest.
  const order = Array.from({ length: k }, (_, j) => j).sort((a, b) => centers[a] - centers[b]);
  const rank = new Int32Array(k);
  order.forEach((j, r) => { rank[j] = r; });
  for (const t of idx) cls[t] = rank[cls[t]];
  return { centers: Float64Array.from(order.map((j) => centers[j])), cls };
}

function levelName(rank: number, levels: number): string {
  if (levels === 2) return rank === 0 ? 'thin' : 'thick';
  if (levels === 3) return ['thin', 'medium', 'thick'][rank];
  if (levels === 4) return ['thinnest', 'thin', 'thick', 'thickest'][rank];
  if (levels === 5) return ['thinnest', 'thin', 'medium', 'thick', 'thickest'][rank];
  return `level ${rank + 1}`;
}

export const thicknessDetector: PartDetector = {
  id: 'thickness',
  name: 'Thickness (limbs vs body)',
  description: 'Splits parts by how thick the solid is under each triangle (limbs thin, torso medium, head and ball thick) — useful where no groove exists. Without seeds it clusters the surface into thickness levels; with seeds, thickness jumps act like grooves for the crease-watershed growth, so named seeds meet where the shape changes girth.',
  bestFor: 'Limbs vs torso on fused figures where no groove separates them; pair with seeds for named parts.',
  seeds: 'optional',
  params: [
    {
      key: 'resolution', label: 'Resolution', type: 'integer', default: 160, min: 48, max: 256, step: 8,
      hint: 'Voxels along the longest side used to measure thickness. Higher resolves thinner features (fingers, ears) but is slower and uses much more memory on the first run; the other sliders then re-run instantly.',
    },
    {
      key: 'smoothing', label: 'Smoothing', type: 'integer', default: 8, min: 0, max: 30, step: 1,
      hint: 'Edge-preserving smoothing passes over the thickness map. Removes scan noise without blurring the jump between a limb and the body; raise for ragged boundaries.',
    },
    {
      key: 'levels', label: 'Thickness levels', type: 'integer', default: 3, min: 2, max: 6, step: 1,
      hint: 'No seeds only: how many thickness classes to split into (2 = thin vs thick, 3 adds medium). Figurines with a base plate often need 5 to peel thin limbs off the torso.',
    },
    {
      key: 'minPartPct', label: 'Absorb below (%)', type: 'number', default: 1, min: 0, max: 10, step: 0.1,
      hint: 'No seeds only: parts smaller than this percentage of the surface are folded into their neighbour.',
    },
    {
      key: 'jumpWeight', label: 'Thickness jump', type: 'number', default: 0.3, min: 0, max: 10, step: 0.1,
      hint: 'Seeded only: how strongly a change in thickness acts like a groove. 1 ≈ a 10% thickness jump counts as a 10° crease; the default 0.3 adds a gentle pull. Higher = boundaries cling to thickness changes (use it where no groove exists).',
    },
    {
      key: 'creaseWeight', label: 'Groove weight', type: 'number', default: 1, min: 0, max: 5, step: 0.1,
      hint: 'Seeded only: how much real grooves still count next to thickness jumps (0 = thickness only, 1 = grooves count in full).',
    },
  ],
  presets: [
    { name: 'Balanced', params: {} },
    { name: 'Two levels', params: { levels: 2 } },
    { name: 'Four levels', params: { levels: 4 } },
    { name: 'Fine detail', params: { resolution: 240 } },
    { name: 'Keep small parts', params: { minPartPct: 0.2 } },
    { name: 'Smoother', params: { smoothing: 20 } },
    { name: 'Limbs and torso', params: { levels: 5, smoothing: 12 } },
  ],
  run(mesh: SegMesh, f: MeshFeatures, ctx): DetectorResult {
    const resolution = Number(ctx.params.resolution);
    const key = `thickness:${featureOptionsKey(f.options)}:${resolution}:${maskKey(ctx.allow)}`;
    let field = ctx.cache?.get(key) as ThicknessField | undefined;
    if (!field) {
      field = computeThickness(mesh, f, resolution, ctx.allow, ctx.signal, ctx.progress);
      ctx.cache?.set(key, field);
    }
    ctx.progress?.(0.96, 'Smoothing…');
    const t0 = performance.now();
    const s = smoothLogThickness(f, field.logT, Number(ctx.params.smoothing), ctx.allow, ctx.signal);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < f.triCount; t++) {
      if (ctx.allow && !ctx.allow[t]) continue;
      if (s[t] < lo) lo = s[t];
      if (s[t] > hi) hi = s[t];
    }
    const diag = {
      voxel: field.voxel,
      grid: field.grid,
      thicknessRange: lo <= hi ? [Math.exp(lo), Math.exp(hi)] as [number, number] : null,
      msVoxelize: Math.round(field.msVoxelize),
      msDistance: Math.round(field.msDistance),
      msMarch: Math.round(field.msMarch),
    };

    // Only pins a person (or the AI) placed switch to seeded mode. The draft
    // gives every part an automatic pin, and re-runs / presets pass those back.
    // Honouring them would freeze an unseeded result: changing `levels` would
    // just regrow the same parts.
    const userSeeds = (ctx.seeds ?? []).filter((sd) => !sd.auto);
    const { names, seedTris, seedLabels, seedMaxRadius } = resolveSeeds(f, userSeeds, ctx.allow, 'drop');
    if (names.length > 0) {
      // --- Seeded: thickness jumps join the crease cost -----------------------
      const cw = Number(ctx.params.creaseWeight), jw = Number(ctx.params.jumpWeight);
      const combined = new Float32Array(f.creaseCost.length);
      for (let e = 0; e < combined.length; e++) {
        combined[e] = f.creaseCost[e] * cw + jw * 100 * Math.abs(s[f.edgeA[e]] - s[f.edgeB[e]]);
      }
      const g = growFromSeeds({ ...f, creaseCost: combined }, seedTris, seedLabels, {
        growth: 'hybrid', creaseQuantumDeg: 5, creaseWeight: 1,
        allow: ctx.allow, signal: ctx.signal, progress: ctx.progress, seedMaxRadius,
      });
      let unreached = 0;
      for (let t = 0; t < f.triCount; t++) if (g.triLabel[t] < 0 && (!ctx.allow || ctx.allow[t])) unreached++;
      return {
        triPart: g.triLabel,
        partNames: names,
        vertexCosts: vertexCostField(mesh.triVerts, mesh.positions.length / 3, g.triLabel, g.cost),
        diagnostics: { ...diag, mode: 'seeded', seedCount: seedTris.length, unreachedTriangles: unreached, msSmooth: Math.round(performance.now() - t0) },
      };
    }

    // --- Unseeded: cluster ln(thickness) into levels -------------------------
    ctx.progress?.(0.98, 'Clustering…');
    const levels = Number(ctx.params.levels);
    const { centers, cls } = kmeans1d(s, f.triArea, ctx.allow, levels);
    const adj = adjacencyFromPairs(f.triCount, f.edgeA, f.edgeB);
    // Connected components of same-class triangles.
    const triPart = new Int32Array(f.triCount).fill(-1);
    const classOfPart: number[] = [];
    const stack: number[] = [];
    for (let seed = 0; seed < f.triCount; seed++) {
      if (cls[seed] < 0 || triPart[seed] >= 0) continue;
      const id = classOfPart.length;
      classOfPart.push(cls[seed]);
      triPart[seed] = id;
      stack.push(seed);
      while (stack.length) {
        const t = stack.pop()!;
        for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
          const o = adj.nbr[j];
          if (triPart[o] < 0 && cls[o] === cls[seed]) { triPart[o] = id; stack.push(o); }
        }
      }
    }
    const initialRegions = classOfPart.length;
    const minArea = (Number(ctx.params.minPartPct) / 100) * f.totalArea;
    if (minArea > 0) {
      absorbSmallRegions(triPart, adj, f.triArea, minArea, ABSORB_ROUNDS);
      // Absorption may have pulled unassigned or outside triangles in — keep
      // the allow contract.
      if (ctx.allow) for (let t = 0; t < f.triCount; t++) if (!ctx.allow[t]) triPart[t] = -1;
    }
    // Number parts by descending area, named by class rank + index.
    const area = new Map<number, number>();
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) area.set(triPart[t], (area.get(triPart[t]) ?? 0) + f.triArea[t]);
    const order = [...area.keys()].sort((x, y) => area.get(y)! - area.get(x)! || x - y);
    const remap = new Map(order.map((r, i) => [r, i] as const));
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) triPart[t] = remap.get(triPart[t])!;
    const perClass = new Int32Array(levels);
    const partNames = order.map((r) => {
      const c = classOfPart[r];
      return `${levelName(c, levels)} ${++perClass[c]}`;
    });
    return {
      triPart,
      partNames,
      genericNames: true,
      diagnostics: {
        ...diag, mode: 'unseeded',
        levelCenters: Array.from(centers, (c) => Math.exp(c)),
        initialRegions, parts: order.length,
        msSmooth: Math.round(performance.now() - t0),
      },
    };
  },
};
