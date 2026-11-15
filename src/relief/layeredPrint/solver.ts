// HueForge-style solver: photo → filament swap schedule + per-pixel heights.
//
// Given a photo and a pool of candidate filaments (colour + TD), it
//   1. picks `numColors` filaments, their order, and the layer at which each one
//      starts (the swap schedule), minimising the colour error over the image;
//   2. assigns every pixel the layer height whose composited colour best matches
//      it, with an edge-preserving smoothness term so the surface isn't noisy.
// The result drives the heightmap mesh (mesh.ts), the 3MF layer-change plan
// (export/layeredPrint3mf.ts), and a predicted-appearance preview image.
//
// Pure, deterministic (seeded), DOM-free: runs in the browser, in Node (the
// `partwright layered-print` CLI), and in the vitest unit tier.

import { LAYERED_PRINT_FILAMENT_LIBRARY, type LayeredPrintFilament } from './filamentLibrary';
import {
  computeLadder, ladderToLab, layerCountFor, layerTop, layerBottom, rgb01ToLab,
  type LayerSpec, type ScheduleBlock,
} from './optics';

/** Minimal RGBA raster (ImageData-compatible). Row 0 is the TOP of the image. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface LayeredPrintOptions {
  /** Maximum number of distinct filaments (= swaps + 1), 1..16. Swaps that
   *  barely change the result are pruned (see `pruneDeltaE`). */
  numColors: number;
  /** Printed width in mm; depth follows the image aspect. */
  widthMm: number;
  /** Size of one heightmap pixel in mm (0.2–0.5 suits a 0.4 mm nozzle). */
  pixelSizeMm: number;
  layerHeight: number;
  firstLayerHeight: number;
  /** Tallest point of the print, mm. More height = more shades per filament. */
  maxHeightMm: number;
  /** Minimum thickness everywhere (the solid backing), mm. */
  baseHeightMm: number;
  /** Candidate filaments. When more than `numColors`, the solver picks the
   *  subset; when fewer, it uses all of them. Default: the built-in library. */
  filaments?: readonly LayeredPrintFilament[];
  /** Force the bottom (base) filament by name. Default: the darkest candidate. */
  baseFilament?: string;
  /** Weight of hue/chroma vs lightness in the colour match. 1 = full colour
   *  match; 0 = lightness only (classic luminance HueForge). */
  chromaWeight: number;
  /** Edge-preserving smoothness of the height field (0 = none). */
  smoothing: number;
  /** Box-blur passes on the photo before matching (denoise; 0 = off). */
  denoise: number;
  /** Search effort: schedule evaluations spent refining the greedy start
   *  (each evaluation scores one candidate swap plan against the photo). */
  iterations: number;
  /** RNG seed (the solve is deterministic for a given seed). */
  seed: number;
  /** A filament swap is dropped when removing it raises the mean colour error
   *  by less than this (ΔE). 0 drops only swaps whose removal doesn't hurt. */
  pruneDeltaE: number;
  /** Refuse grids larger than this many cells (memory / mesh-size guard). */
  maxCells: number;
  /** Refuse plans with more print layers than this. */
  maxLayers: number;
}

export const DEFAULT_LAYERED_PRINT_OPTIONS: LayeredPrintOptions = {
  numColors: 8,
  widthMm: 120,
  pixelSizeMm: 0.3,
  layerHeight: 0.08,
  firstLayerHeight: 0.16,
  maxHeightMm: 2.4,
  baseHeightMm: 0.48,
  chromaWeight: 1,
  smoothing: 1.2,
  denoise: 1,
  iterations: 60000,
  seed: 1,
  pruneDeltaE: 0.05,
  maxCells: 1_000_000,
  maxLayers: 160,
};

/** One filament change, in slicer terms. */
export interface LayeredPrintSwap {
  /** 1-based slicer layer number where the new filament starts. */
  layer: number;
  /** print_z (top) of that layer, mm — the `top_z` a 3MF layer change uses. */
  z: number;
  filament: LayeredPrintFilament;
}

export interface LayeredPrintResult {
  options: LayeredPrintOptions;
  /** Heightmap grid size (cells). Row 0 is the BOTTOM of the image (world -Y). */
  gridWidth: number;
  gridHeight: number;
  widthMm: number;
  depthMm: number;
  /** 0-based top layer per cell. */
  layerIndex: Uint16Array;
  /** Top Z per cell, mm. */
  heightsMm: Float32Array;
  /** Filament blocks bottom→top (block 0 = base). */
  blocks: ScheduleBlock[];
  swaps: LayeredPrintSwap[];
  totalLayers: number;
  totalHeightMm: number;
  /** Predicted appearance, RGBA, image orientation (row 0 = top). */
  preview: Uint8ClampedArray;
  /** The source photo resampled to the grid, RGBA, image orientation. */
  target: Uint8ClampedArray;
  /** Mean CIE76 ΔE between prediction and photo (lower is better; <10 is good). */
  meanDeltaE: number;
  /** The schedule cost the optimiser minimised (weighted ΔE over colour bins). */
  scheduleCost: number;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-average the photo into a W×H grid; row 0 = bottom of the image. */
function resampleToGrid(img: RgbaImage, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H * 3);
  const sw = img.width, sh = img.height, d = img.data;
  for (let gy = 0; gy < H; gy++) {
    const iy = H - 1 - gy; // flip: image top → world +Y
    const y0 = Math.floor((iy * sh) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((iy + 1) * sh) / H));
    for (let gx = 0; gx < W; gx++) {
      const x0 = Math.floor((gx * sw) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let o = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++, o += 4) {
          // Composite transparent pixels over white (a transparent PNG
          // background prints as the lightest shade rather than black).
          const a = d[o + 3] / 255;
          r += d[o] * a + 255 * (1 - a);
          g += d[o + 1] * a + 255 * (1 - a);
          b += d[o + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const c = (gy * W + gx) * 3;
      out[c] = r / n / 255;
      out[c + 1] = g / n / 255;
      out[c + 2] = b / n / 255;
    }
  }
  return out;
}

function boxBlur3(rgb: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const o = (yy * W + xx) * 3;
          // Centre weighted 4, edges 2, corners 1 (a small Gaussian).
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          r += rgb[o] * w; g += rgb[o + 1] * w; b += rgb[o + 2] * w; n += w;
        }
      }
      const o = (y * W + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

/** Weighted colour histogram in Lab — the optimiser scores schedules against
 *  these bins instead of every pixel. */
interface ColorBins { lab: Float32Array; weight: Float32Array; count: number }

function buildBins(lab: Float32Array, rgb: Float32Array, n: number, bits: number): ColorBins {
  const shift = 8 - bits;
  const size = 1 << (bits * 3);
  const sum = new Float64Array(size * 3);
  const cnt = new Float64Array(size);
  for (let p = 0; p < n; p++) {
    const r = Math.min(255, Math.round(rgb[p * 3] * 255)) >> shift;
    const g = Math.min(255, Math.round(rgb[p * 3 + 1] * 255)) >> shift;
    const b = Math.min(255, Math.round(rgb[p * 3 + 2] * 255)) >> shift;
    const k = (r << (bits * 2)) | (g << bits) | b;
    sum[k * 3] += lab[p * 3]; sum[k * 3 + 1] += lab[p * 3 + 1]; sum[k * 3 + 2] += lab[p * 3 + 2];
    cnt[k]++;
  }
  let used = 0;
  for (let k = 0; k < size; k++) if (cnt[k] > 0) used++;
  const out: ColorBins = { lab: new Float32Array(used * 3), weight: new Float32Array(used), count: used };
  let j = 0;
  for (let k = 0; k < size; k++) {
    if (cnt[k] === 0) continue;
    out.lab[j * 3] = sum[k * 3] / cnt[k];
    out.lab[j * 3 + 1] = sum[k * 3 + 1] / cnt[k];
    out.lab[j * 3 + 2] = sum[k * 3 + 2] / cnt[k];
    out.weight[j] = cnt[k] / n;
    j++;
  }
  return out;
}

/** Bins small enough for the search to stay fast: a fine 5-bit histogram,
 *  then the heaviest `maxBins` bins are kept and every other bin is folded
 *  (weight and colour) into its nearest kept bin in Lab. Coarser quantisation
 *  would average genuinely different colours together and mislead the search. */
function reduceBins(fine: ColorBins, maxBins: number): ColorBins {
  if (fine.count <= maxBins) return fine;
  const order = Array.from({ length: fine.count }, (_, i) => i).sort((a, b) => fine.weight[b] - fine.weight[a]);
  const keep = order.slice(0, maxBins);
  const sum = new Float64Array(maxBins * 3);
  const w = new Float64Array(maxBins);
  keep.forEach((j, k) => {
    sum[k * 3] = fine.lab[j * 3] * fine.weight[j];
    sum[k * 3 + 1] = fine.lab[j * 3 + 1] * fine.weight[j];
    sum[k * 3 + 2] = fine.lab[j * 3 + 2] * fine.weight[j];
    w[k] = fine.weight[j];
  });
  for (let r = maxBins; r < order.length; r++) {
    const j = order[r];
    const L0 = fine.lab[j * 3], a0 = fine.lab[j * 3 + 1], b0 = fine.lab[j * 3 + 2];
    let best = Infinity, bk = 0;
    for (let k = 0; k < maxBins; k++) {
      const q = keep[k];
      const dL = fine.lab[q * 3] - L0, da = fine.lab[q * 3 + 1] - a0, db = fine.lab[q * 3 + 2] - b0;
      const d = dL * dL + da * da + db * db;
      if (d < best) { best = d; bk = k; }
    }
    const wt = fine.weight[j];
    sum[bk * 3] += L0 * wt; sum[bk * 3 + 1] += a0 * wt; sum[bk * 3 + 2] += b0 * wt;
    w[bk] += wt;
  }
  const out: ColorBins = { lab: new Float32Array(maxBins * 3), weight: new Float32Array(maxBins), count: maxBins };
  for (let k = 0; k < maxBins; k++) {
    out.lab[k * 3] = sum[k * 3] / w[k];
    out.lab[k * 3 + 1] = sum[k * 3 + 1] / w[k];
    out.lab[k * 3 + 2] = sum[k * 3 + 2] / w[k];
    out.weight[k] = w[k];
  }
  return out;
}

function adaptiveBins(lab: Float32Array, rgb: Float32Array, n: number): ColorBins {
  return reduceBins(buildBins(lab, rgb, n, 5), 400);
}

function luminanceOf(f: LayeredPrintFilament): number {
  const h = f.hex.replace(/^#/, '');
  const n = parseInt(h, 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

// ── schedule search ─────────────────────────────────────────────────────────

/** Mutable schedule: filament pool indices + 0-based start layers (ascending). */
interface Sched { f: number[]; s: number[] }

class ScheduleScorer {
  evals = 0;
  private readonly bins: ColorBins;
  private readonly pool: readonly LayeredPrintFilament[];
  private readonly L: number;
  private readonly minLayer: number;
  private readonly spec: LayerSpec;
  private readonly chroma: number;
  constructor(bins: ColorBins, pool: readonly LayeredPrintFilament[], L: number, minLayer: number, spec: LayerSpec, chroma: number) {
    this.bins = bins; this.pool = pool; this.L = L; this.minLayer = minLayer; this.spec = spec; this.chroma = chroma;
  }

  blocksOf(sc: Sched): ScheduleBlock[] {
    return sc.f.map((fi, k) => ({ filament: this.pool[fi], startLayer: sc.s[k] }));
  }

  cost(sc: Sched): number {
    this.evals++;
    const ladderLab = ladderToLab(computeLadder(this.blocksOf(sc), this.L, this.spec));
    const { lab, weight, count } = this.bins;
    const w = this.chroma;
    let total = 0;
    for (let j = 0; j < count; j++) {
      const L0 = lab[j * 3], a0 = lab[j * 3 + 1], b0 = lab[j * 3 + 2];
      let best = Infinity;
      for (let i = this.minLayer; i < this.L; i++) {
        const dL = ladderLab[i * 3] - L0;
        const da = ladderLab[i * 3 + 1] - a0;
        const db = ladderLab[i * 3 + 2] - b0;
        const d = dL * dL + w * (da * da + db * db);
        if (d < best) best = d;
      }
      total += weight[j] * Math.sqrt(best);
    }
    return total;
  }
}

function normalize(sc: Sched): Sched {
  const order = sc.s.map((_, k) => k).sort((a, b) => sc.s[a] - sc.s[b]);
  return { f: order.map((k) => sc.f[k]), s: order.map((k) => sc.s[k]) };
}

function cloneSched(sc: Sched): Sched {
  return { f: sc.f.slice(), s: sc.s.slice() };
}

/** Greedy build: start from the base, then repeatedly insert the
 *  (filament, start layer) that lowers the cost most. */
function greedySchedule(scorer: ScheduleScorer, poolSize: number, N: number, L: number, baseIdx: number): Sched {
  let sc: Sched = { f: [baseIdx], s: [0] };
  for (let step = 1; step < N; step++) {
    let best: Sched | null = null;
    let bestCost = Infinity;
    const used = new Set(sc.f);
    for (let c = 0; c < poolSize; c++) {
      if (used.has(c)) continue;
      for (let s = 1; s < L; s++) {
        if (sc.s.includes(s)) continue;
        const cand = normalize({ f: [...sc.f, c], s: [...sc.s, s] });
        const cost = scorer.cost(cand);
        if (cost < bestCost) { bestCost = cost; best = cand; }
      }
    }
    if (!best) break;
    sc = best;
  }
  return sc;
}

/** One exhaustive "relocate" sweep: for each block in random order, pull it
 *  out and re-insert the best (filament, start layer) anywhere in the stack —
 *  which covers swapping the filament, sliding the swap height, and moving a
 *  colour past its neighbours. The base (block 0) can only change filament,
 *  and only when not locked. Returns once a full sweep finds no improvement
 *  or the evaluation budget runs out. */
function localSearch(scorer: ScheduleScorer, start: Sched, startCost: number, poolSize: number, L: number, rand: () => number, lockBase: boolean, budget: number): { sched: Sched; cost: number } {
  let cur = cloneSched(start);
  let curCost = startCost;
  let improved = true;
  while (improved && scorer.evals < budget) {
    improved = false;
    const order = cur.f.map((_, k) => k);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (const k of order) {
      if (scorer.evals >= budget || k >= cur.f.length) break;
      let best: Sched | null = null;
      let bestCost = curCost - 1e-9;
      if (k === 0) {
        if (lockBase) continue;
        for (let c = 0; c < poolSize; c++) {
          if (cur.f.includes(c)) continue;
          const cand = cloneSched(cur);
          cand.f[0] = c;
          const cost = scorer.cost(cand);
          if (cost < bestCost) { bestCost = cost; best = cand; }
        }
      } else {
        const restF = cur.f.filter((_, j) => j !== k);
        const restS = cur.s.filter((_, j) => j !== k);
        for (let c = 0; c < poolSize; c++) {
          if (restF.includes(c)) continue;
          for (let st = 1; st < L; st++) {
            if (restS.includes(st)) continue;
            const cand = normalize({ f: [...restF, c], s: [...restS, st] });
            const cost = scorer.cost(cand);
            if (cost < bestCost) { bestCost = cost; best = cand; }
          }
        }
      }
      if (best) { cur = best; curCost = bestCost; improved = true; }
    }
  }
  return { sched: cur, cost: curCost };
}

/** Simulated annealing over cheap random moves (shift a swap layer, swap a
 *  filament, reorder neighbours, relocate a block). Escapes the basins the
 *  exhaustive one-block search gets stuck in (e.g. one filament filling the
 *  whole stack, where any single insertion splits it and looks worse). */
function anneal(scorer: ScheduleScorer, start: Sched, poolSize: number, L: number, iters: number, rand: () => number, lockBase: boolean): { sched: Sched; cost: number } {
  let cur = cloneSched(start);
  let curCost = scorer.cost(cur);
  let best = cloneSched(cur);
  let bestCost = curCost;
  const n = cur.f.length;
  if (n < 2) return { sched: best, cost: bestCost };
  const T0 = curCost * 0.03;
  for (let it = 0; it < iters; it++) {
    const T = T0 * (1 - it / iters) + 1e-9;
    let cand = cloneSched(cur);
    const move = rand();
    if (move < 0.4) {
      const k = 1 + Math.floor(rand() * (n - 1));
      const delta = (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 3));
      const lo = cand.s[k - 1] + 1;
      const hi = k + 1 < n ? cand.s[k + 1] - 1 : L - 1;
      const ns = Math.max(lo, Math.min(hi, cand.s[k] + delta));
      if (ns === cand.s[k]) continue;
      cand.s[k] = ns;
    } else if (move < 0.7) {
      const k = lockBase ? 1 + Math.floor(rand() * (n - 1)) : Math.floor(rand() * n);
      const c = Math.floor(rand() * poolSize);
      if (cand.f.includes(c)) continue;
      cand.f[k] = c;
    } else if (move < 0.85) {
      const lo = lockBase ? 1 : 0;
      if (n - lo < 2) continue;
      const k = lo + Math.floor(rand() * (n - 1 - lo));
      const t = cand.f[k]; cand.f[k] = cand.f[k + 1]; cand.f[k + 1] = t;
    } else {
      const k = 1 + Math.floor(rand() * (n - 1));
      const ns = 1 + Math.floor(rand() * (L - 1));
      if (cand.s.includes(ns)) continue;
      cand.s[k] = ns;
      cand = normalize(cand);
    }
    const cost = scorer.cost(cand);
    if (cost < curCost || rand() < Math.exp((curCost - cost) / T)) {
      cur = cand;
      curCost = cost;
      if (cost < bestCost) { best = cloneSched(cand); bestCost = cost; }
    }
  }
  return { sched: best, cost: bestCost };
}

/** Weighted k-means over the colour bins (Lab) → N centroids. */
function kmeansBins(bins: ColorBins, N: number, rand: () => number): Array<[number, number, number]> {
  const cent: Array<[number, number, number]> = [];
  // k-means++ seeding on weight.
  let pick = 0, wmax = -1;
  for (let j = 0; j < bins.count; j++) if (bins.weight[j] > wmax) { wmax = bins.weight[j]; pick = j; }
  cent.push([bins.lab[pick * 3], bins.lab[pick * 3 + 1], bins.lab[pick * 3 + 2]]);
  const d2 = new Float64Array(bins.count);
  while (cent.length < Math.min(N, bins.count)) {
    let tot = 0;
    for (let j = 0; j < bins.count; j++) {
      let best = Infinity;
      for (const c of cent) {
        const dL = bins.lab[j * 3] - c[0], da = bins.lab[j * 3 + 1] - c[1], db = bins.lab[j * 3 + 2] - c[2];
        best = Math.min(best, dL * dL + da * da + db * db);
      }
      d2[j] = best * bins.weight[j];
      tot += d2[j];
    }
    let r = rand() * tot, j = 0;
    for (; j < bins.count - 1; j++) { r -= d2[j]; if (r <= 0) break; }
    cent.push([bins.lab[j * 3], bins.lab[j * 3 + 1], bins.lab[j * 3 + 2]]);
  }
  for (let iter = 0; iter < 12; iter++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < bins.count; j++) {
      let best = Infinity, bk = 0;
      cent.forEach((c, k) => {
        const dL = bins.lab[j * 3] - c[0], da = bins.lab[j * 3 + 1] - c[1], db = bins.lab[j * 3 + 2] - c[2];
        const d = dL * dL + da * da + db * db;
        if (d < best) { best = d; bk = k; }
      });
      const w = bins.weight[j];
      sum[bk][0] += bins.lab[j * 3] * w; sum[bk][1] += bins.lab[j * 3 + 1] * w; sum[bk][2] += bins.lab[j * 3 + 2] * w; sum[bk][3] += w;
    }
    sum.forEach((sm, k) => { if (sm[3] > 0) cent[k] = [sm[0] / sm[3], sm[1] / sm[3], sm[2] / sm[3]]; });
  }
  return cent;
}

/** Start schedule from the photo's dominant colours: snap each k-means
 *  centroid to the nearest unused filament, order by lightness, and spread
 *  the swaps evenly up the stack. */
function paletteSchedule(bins: ColorBins, pool: readonly LayeredPrintFilament[], N: number, L: number, minLayer: number, rand: () => number, darkFirst: boolean, baseIdx: number, lockBase: boolean): Sched {
  const poolLab = pool.map((f) => { const h = f.hex.replace('#', ''); const v = parseInt(h, 16); return rgb01ToLab(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); });
  const chosen: number[] = lockBase ? [baseIdx] : [];
  const cents = kmeansBins(bins, N + 2, rand);
  for (const c of cents) {
    if (chosen.length >= N) break;
    let best = Infinity, bi = -1;
    poolLab.forEach((p, i) => {
      if (chosen.includes(i)) return;
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    if (bi >= 0) chosen.push(bi);
  }
  for (let i = 0; chosen.length < N && i < pool.length; i++) if (!chosen.includes(i)) chosen.push(i);
  const rest = lockBase ? chosen.slice(1) : chosen;
  rest.sort((a, b) => (darkFirst ? 1 : -1) * (poolLab[a][0] - poolLab[b][0]));
  const f = lockBase ? [baseIdx, ...rest] : rest;
  // Base at 0; the rest spread over [max(1, minLayer - 1), L - 1].
  const lo = Math.max(1, minLayer - 1), hi = L - 1;
  const s = f.map((_, k) => (k === 0 ? 0 : Math.round(lo + ((k - 1) * (hi - lo)) / Math.max(1, f.length - 1))));
  for (let k = 1; k < s.length; k++) if (s[k] <= s[k - 1]) s[k] = s[k - 1] + 1;
  const keep = s.findIndex((v) => v >= L);
  return keep < 0 ? { f, s } : { f: f.slice(0, keep), s: s.slice(0, keep) };
}

// ── height assignment ───────────────────────────────────────────────────────

/** Per-pixel layer choice: colour match + truncated-L1 smoothness (ICM). */
function assignLayers(
  lab: Float32Array, W: number, H: number, ladderLab: Float32Array, L: number,
  minLayer: number, chroma: number, beta: number,
): Uint16Array {
  const n = W * H;
  const K = L - minLayer;
  const data = new Float32Array(n * K);
  const label = new Uint16Array(n);
  for (let p = 0; p < n; p++) {
    const L0 = lab[p * 3], a0 = lab[p * 3 + 1], b0 = lab[p * 3 + 2];
    let best = Infinity, bi = 0;
    for (let k = 0; k < K; k++) {
      const i = k + minLayer;
      const dL = ladderLab[i * 3] - L0, da = ladderLab[i * 3 + 1] - a0, db = ladderLab[i * 3 + 2] - b0;
      const d = Math.sqrt(dL * dL + chroma * (da * da + db * db));
      data[p * K + k] = d;
      if (d < best) { best = d; bi = k; }
    }
    label[p] = bi;
  }
  if (beta > 0 && K > 1) {
    const T = 4; // truncation (layers): real edges stay sharp
    const nb = [0, 0, 0, 0];
    for (let iter = 0; iter < 4; iter++) {
      let changed = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          let m = 0;
          if (x > 0) nb[m++] = label[p - 1];
          if (x < W - 1) nb[m++] = label[p + 1];
          if (y > 0) nb[m++] = label[p - W];
          if (y < H - 1) nb[m++] = label[p + W];
          let best = Infinity, bk = label[p];
          for (let k = 0; k < K; k++) {
            let e = data[p * K + k];
            for (let q = 0; q < m; q++) {
              const dd = k > nb[q] ? k - nb[q] : nb[q] - k;
              e += beta * (dd < T ? dd : T);
            }
            if (e < best) { best = e; bk = k; }
          }
          if (bk !== label[p]) { label[p] = bk; changed++; }
        }
      }
      if (changed === 0) break;
    }
  }
  const out = new Uint16Array(n);
  for (let p = 0; p < n; p++) out[p] = label[p] + minLayer;
  return out;
}

// ── public entry ────────────────────────────────────────────────────────────

/** Resolve user options against defaults and clamp to sane ranges. */
export function resolveLayeredPrintOptions(o: Partial<LayeredPrintOptions> = {}): LayeredPrintOptions {
  const d = DEFAULT_LAYERED_PRINT_OPTIONS;
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  const layerHeight = num(o.layerHeight, d.layerHeight, 0.04, 0.4);
  const firstLayerHeight = num(o.firstLayerHeight, d.firstLayerHeight, 0.04, 0.6);
  const maxHeightMm = num(o.maxHeightMm, d.maxHeightMm, firstLayerHeight + layerHeight, 20);
  return {
    numColors: Math.round(num(o.numColors, d.numColors, 1, 16)),
    widthMm: num(o.widthMm, d.widthMm, 10, 400),
    pixelSizeMm: num(o.pixelSizeMm, d.pixelSizeMm, 0.1, 2),
    layerHeight,
    firstLayerHeight,
    maxHeightMm,
    baseHeightMm: num(o.baseHeightMm, d.baseHeightMm, firstLayerHeight, maxHeightMm),
    filaments: o.filaments,
    baseFilament: o.baseFilament,
    chromaWeight: num(o.chromaWeight, d.chromaWeight, 0, 4),
    smoothing: num(o.smoothing, d.smoothing, 0, 20),
    denoise: Math.round(num(o.denoise, d.denoise, 0, 5)),
    iterations: Math.round(num(o.iterations, d.iterations, 0, 1000000)),
    seed: Math.round(num(o.seed, d.seed, 0, 2 ** 31)),
    pruneDeltaE: num(o.pruneDeltaE, d.pruneDeltaE, 0, 5),
    maxCells: Math.round(num(o.maxCells, d.maxCells, 100, 1e8)),
    maxLayers: Math.round(num(o.maxLayers, d.maxLayers, 2, 10_000)),
  };
}

export function solveLayeredPrint(img: RgbaImage, partial: Partial<LayeredPrintOptions> = {}): LayeredPrintResult {
  const opts = resolveLayeredPrintOptions(partial);
  if (img.width < 2 || img.height < 2) throw new Error('layeredPrint: image too small');
  const spec: LayerSpec = { firstLayerHeight: opts.firstLayerHeight, layerHeight: opts.layerHeight };

  // Grid: one cell per pixelSize, aspect preserved.
  const W = Math.max(2, Math.round(opts.widthMm / opts.pixelSizeMm) + 1);
  const H = Math.max(2, Math.round((W - 1) * (img.height / img.width)) + 1);
  const n = W * H;
  if (n > opts.maxCells) throw new Error(`print is ${W} × ${H} = ${n.toLocaleString('en-US')} cells, over the ${opts.maxCells.toLocaleString('en-US')} limit — use a larger pixelSizeMm or a smaller widthMm`);
  let rgb = resampleToGrid(img, W, H);
  for (let i = 0; i < opts.denoise; i++) rgb = boxBlur3(rgb, W, H);
  const lab = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const [L, a, b] = rgb01ToLab(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    lab[p * 3] = L; lab[p * 3 + 1] = a; lab[p * 3 + 2] = b;
  }

  const L = layerCountFor(opts.maxHeightMm, spec);
  if (L > opts.maxLayers) throw new Error(`${L} layers is over the ${opts.maxLayers}-layer limit — lower maxHeightMm or raise layerHeight`);
  let minLayer = 0;
  while (minLayer < L - 1 && layerTop(minLayer, spec) < opts.baseHeightMm - 1e-6) minLayer++;

  const pool = (opts.filaments && opts.filaments.length > 0 ? opts.filaments : LAYERED_PRINT_FILAMENT_LIBRARY).slice();
  const bins = adaptiveBins(lab, rgb, n);
  const scorer = new ScheduleScorer(bins, pool, L, minLayer, spec, opts.chromaWeight);

  let blocks: ScheduleBlock[];
  let cost: number;
  {
    // Need at least one layer per filament.
    const N = Math.max(1, Math.min(opts.numColors, pool.length, L));
    let baseIdx = -1;
    if (opts.baseFilament) {
      const want = opts.baseFilament.toLowerCase();
      baseIdx = pool.findIndex((f) => f.name.toLowerCase() === want || f.hex.toLowerCase() === want);
    }
    const lockBase = baseIdx >= 0;
    if (baseIdx < 0) {
      // Darkest candidate: the classic HueForge black base.
      baseIdx = 0;
      for (let i = 1; i < pool.length; i++) if (luminanceOf(pool[i]) < luminanceOf(pool[baseIdx])) baseIdx = i;
    }
    // Multi-start: the photo's palette ordered dark→light (classic HueForge)
    // and light→dark (ink on paper), plus a greedy build. Each start is
    // annealed, then polished by the exhaustive one-block search; best wins.
    const rand = mulberry32(opts.seed);
    const starts: Sched[] = [
      paletteSchedule(bins, pool, N, L, minLayer, rand, true, baseIdx, lockBase),
      paletteSchedule(bins, pool, N, L, minLayer, rand, false, baseIdx, lockBase),
      greedySchedule(scorer, pool.length, N, L, baseIdx),
    ];
    const per = Math.floor(opts.iterations / starts.length);
    let refined = { sched: starts[0], cost: Infinity };
    for (const st of starts) {
      const a = anneal(scorer, st, pool.length, L, Math.floor(per * 0.6), rand, lockBase);
      const r = localSearch(scorer, a.sched, a.cost, pool.length, L, rand, lockBase, scorer.evals + Math.ceil(per * 0.4));
      if (r.cost < refined.cost) refined = r;
    }
    // Drop swaps that don't earn their keep: every filament change is real
    // work at the printer, so a block whose removal costs < pruneDeltaE goes.
    let pruned = refined;
    for (let changed = true; changed && pruned.sched.f.length > 1;) {
      changed = false;
      let bestK = -1, bestCost = Infinity;
      for (let k = 1; k < pruned.sched.f.length; k++) {
        const cand = { f: pruned.sched.f.filter((_, j) => j !== k), s: pruned.sched.s.filter((_, j) => j !== k) };
        const c = scorer.cost(cand);
        if (c < bestCost) { bestCost = c; bestK = k; }
      }
      if (bestK >= 0 && bestCost - pruned.cost < opts.pruneDeltaE) {
        const cand = { f: pruned.sched.f.filter((_, j) => j !== bestK), s: pruned.sched.s.filter((_, j) => j !== bestK) };
        // Let the remaining swaps re-settle around the gap.
        pruned = localSearch(scorer, cand, bestCost, pool.length, L, rand, lockBase, scorer.evals + 8000);
        changed = true;
      }
    }
    refined = pruned;
    blocks = scorer.blocksOf(refined.sched);
    cost = refined.cost;
  }

  const ladder = computeLadder(blocks, L, spec);
  const ladderLab = ladderToLab(ladder);
  const layerIndex = assignLayers(lab, W, H, ladderLab, L, minLayer, opts.chromaWeight, opts.smoothing);

  // Heights, preview, error.
  const heightsMm = new Float32Array(n);
  const preview = new Uint8ClampedArray(n * 4);
  const target = new Uint8ClampedArray(n * 4);
  let dE = 0;
  let maxLayer = 0;
  for (let gy = 0; gy < H; gy++) {
    const iy = H - 1 - gy;
    for (let x = 0; x < W; x++) {
      const p = gy * W + x;
      const li = layerIndex[p];
      if (li > maxLayer) maxLayer = li;
      heightsMm[p] = layerTop(li, spec);
      const o = (iy * W + x) * 4;
      preview[o] = ladder[li * 3] * 255;
      preview[o + 1] = ladder[li * 3 + 1] * 255;
      preview[o + 2] = ladder[li * 3 + 2] * 255;
      preview[o + 3] = 255;
      target[o] = rgb[p * 3] * 255;
      target[o + 1] = rgb[p * 3 + 1] * 255;
      target[o + 2] = rgb[p * 3 + 2] * 255;
      target[o + 3] = 255;
      const dL = ladderLab[li * 3] - lab[p * 3];
      const da = ladderLab[li * 3 + 1] - lab[p * 3 + 1];
      const db = ladderLab[li * 3 + 2] - lab[p * 3 + 2];
      dE += Math.sqrt(dL * dL + da * da + db * db);
    }
  }

  // Drop blocks that start above the tallest pixel — they would never print.
  const printed = blocks.filter((b, k) => k === 0 || b.startLayer <= maxLayer);
  const swaps: LayeredPrintSwap[] = printed.slice(1).map((b) => ({
    layer: b.startLayer + 1,
    z: round3(layerTop(b.startLayer, spec)),
    filament: b.filament,
  }));

  return {
    options: opts,
    gridWidth: W,
    gridHeight: H,
    widthMm: opts.pixelSizeMm * (W - 1),
    depthMm: opts.pixelSizeMm * (H - 1),
    layerIndex,
    heightsMm,
    blocks: printed,
    swaps,
    totalLayers: maxLayer + 1,
    totalHeightMm: round3(layerTop(maxLayer, spec)),
    preview,
    target,
    meanDeltaE: dE / n,
    scheduleCost: cost,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** JSON-friendly summary (no big arrays). */
export function layeredPrintSummary(r: LayeredPrintResult): {
  filaments: Array<{ name: string; hex: string; td: number; startLayer: number; startZ: number }>;
  swaps: Array<{ layer: number; z: number; filament: string; hex: string }>;
  totalLayers: number; totalHeightMm: number; widthMm: number; depthMm: number;
  layerHeight: number; firstLayerHeight: number; meanDeltaE: number;
} {
  const spec: LayerSpec = { firstLayerHeight: r.options.firstLayerHeight, layerHeight: r.options.layerHeight };
  return {
    filaments: r.blocks.map((b) => ({ name: b.filament.name, hex: b.filament.hex, td: b.filament.td, startLayer: b.startLayer + 1, startZ: round3(layerBottom(b.startLayer, spec)) })),
    swaps: r.swaps.map((s) => ({ layer: s.layer, z: s.z, filament: s.filament.name, hex: s.filament.hex })),
    totalLayers: r.totalLayers,
    totalHeightMm: r.totalHeightMm,
    widthMm: round1(r.widthMm),
    depthMm: round1(r.depthMm),
    layerHeight: r.options.layerHeight,
    firstLayerHeight: r.options.firstLayerHeight,
    meanDeltaE: Math.round(r.meanDeltaE * 10) / 10,
  };
}
