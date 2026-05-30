// Image → printable colour-tile / stepped-relief mesh generation.
//
// A relief is built directly from a regular grid of heights, NOT by unioning
// per-pixel boxes (which would be O(cells) boolean ops and far too slow). The
// top surface follows the grid, vertical skirt walls drop to z=0, and a flat
// bottom closes the solid so the result is edge-manifold and accepted by
// Manifold.ofMesh().

import type {
  HeightGrid,
  ReliefMesh,
  ReliefOptions,
  PreprocessOptions,
  SeedRegion,
  GenerateReliefResult,
} from './types';
import { DEFAULT_RELIEF_OPTIONS } from './types';

/** Brightness / contrast / saturation / levels applied to the downsampled
 *  image in sRGB byte space. In-place over the interleaved RGB Float32 grid.
 *  Operates BEFORE smoothing so the smoothed image already reflects the user's
 *  tonal corrections. */
export function preprocessRgb(rgb: Float32Array, w: number, h: number, p: PreprocessOptions): void {
  const total = w * h;
  const noOp =
    p.brightness === 0 && p.contrast === 0 && p.saturation === 0 &&
    p.levelsLow === 0 && p.levelsHigh === 255;
  if (noOp) return;

  const lo = Math.max(0, Math.min(254, p.levelsLow));
  const hi = Math.max(lo + 1, Math.min(255, p.levelsHigh));
  const levelsScale = 255 / (hi - lo);
  const brightAdd = Math.max(-1, Math.min(1, p.brightness)) * 128;
  // Standard contrast formula centred on 128. c in -1..+1 maps to a multiplier
  // that compresses (c<0) or expands (c>0) the dynamic range around mid-grey.
  const c = Math.max(-1, Math.min(1, p.contrast));
  const cf = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
  const sat = 1 + Math.max(-1, Math.min(1, p.saturation));

  for (let i = 0; i < total; i++) {
    const o = i * 3;
    let r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
    // Levels.
    r = (r - lo) * levelsScale;
    g = (g - lo) * levelsScale;
    b = (b - lo) * levelsScale;
    // Brightness.
    r += brightAdd; g += brightAdd; b += brightAdd;
    // Contrast.
    r = cf * (r - 128) + 128;
    g = cf * (g - 128) + 128;
    b = cf * (b - 128) + 128;
    // Saturation: blend each channel toward the cell's luminance.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * sat;
    g = lum + (g - lum) * sat;
    b = lum + (b - lum) * sat;
    rgb[o]     = r < 0 ? 0 : r > 255 ? 255 : r;
    rgb[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgb[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}
import { buildTileMesh, buildCellMask, type TileOptions, type TileShape } from './tileMesh';
import { parseSvgToTile } from '../import/parsers/svg';

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function luminance255(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** Box/average downsample of an RGBA ImageData into per-cell mean RGB stored as
 *  Float32 (one [r,g,b] triple per cell, components 0..255). Columns are capped
 *  at `resolution`; rows scale to preserve aspect. When a crop is provided
 *  (image-pixel coords, top-down), only that rectangle is sampled. */
function downsample(
  image: ImageData,
  resolution: number,
  cropPx?: { left: number; top: number; right: number; bottom: number },
): { width: number; height: number; rgb: Float32Array } {
  const imgW = image.width;
  const imgH = image.height;
  const cl = cropPx ? Math.max(0, Math.min(imgW - 1, Math.floor(cropPx.left))) : 0;
  const ct = cropPx ? Math.max(0, Math.min(imgH - 1, Math.floor(cropPx.top))) : 0;
  const cr = cropPx ? Math.max(cl + 1, Math.min(imgW, Math.floor(cropPx.right))) : imgW;
  const cb = cropPx ? Math.max(ct + 1, Math.min(imgH, Math.floor(cropPx.bottom))) : imgH;
  const srcW = cr - cl;
  const srcH = cb - ct;
  const cols = Math.max(1, Math.min(resolution, srcW));
  // Preserve aspect: rows track the same px/cell scale as columns.
  const scale = cols / srcW;
  const rows = Math.max(1, Math.round(srcH * scale));

  const src = image.data;
  const rgb = new Float32Array(cols * rows * 3);

  // Canvas Y points down; world Y points up. Read the SOURCE rows in reverse
  // so that grid row 0 corresponds to the BOTTOM of the image — buildReliefMesh
  // then places grid Y=0 at world -Y, so a top-view render shows the image
  // right-side-up (otherwise a smiley imports as a frown).
  for (let cy = 0; cy < rows; cy++) {
    const fcy = rows - 1 - cy;
    const y0 = ct + Math.floor((fcy * srcH) / rows);
    const y1 = Math.max(y0 + 1, ct + Math.floor(((fcy + 1) * srcH) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cl + Math.floor((cx * srcW) / cols);
      const x1 = Math.max(x0 + 1, cl + Math.floor(((cx + 1) * srcW) / cols));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let p = (sy * imgW + x0) * 4;
        for (let sx = x0; sx < x1; sx++) {
          sr += src[p];
          sg += src[p + 1];
          sb += src[p + 2];
          p += 4;
          n++;
        }
      }
      const inv = n > 0 ? 1 / n : 0;
      const o = (cy * cols + cx) * 3;
      rgb[o] = sr * inv;
      rgb[o + 1] = sg * inv;
      rgb[o + 2] = sb * inv;
    }
  }

  return { width: cols, height: rows, rgb };
}

/** Resolve a normalised crop (0..1) to image pixels, or null if it covers the
 *  full image (cheap fast path). */
function cropToPixels(image: ImageData, crop: ReliefOptions['crop']): { left: number; top: number; right: number; bottom: number } | null {
  if (!crop) return null;
  const fullW = Math.abs(crop.right - crop.left) >= 0.999 && crop.left <= 0.001;
  const fullH = Math.abs(crop.bottom - crop.top) >= 0.999 && crop.top <= 0.001;
  if (fullW && fullH) return null;
  return {
    left: crop.left * image.width,
    top: crop.top * image.height,
    right: crop.right * image.width,
    bottom: crop.bottom * image.height,
  };
}

/** Separable box blur (radius `r` cells) over an interleaved RGB Float32 grid.
 *  A box blur repeated would approach Gaussian; one pass is enough smoothing for
 *  relief sampling and keeps this dependency-free and fast. */
function blurRGB(rgb: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return rgb;
  const radius = Math.round(r);
  if (radius <= 0) return rgb;

  const tmp = new Float32Array(rgb.length);
  const out = new Float32Array(rgb.length);
  const win = radius * 2 + 1;
  const inv = 1 / win;

  // Horizontal pass: rgb -> tmp.
  for (let y = 0; y < h; y++) {
    const row = y * w * 3;
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clampIndex(k, w);
        acc += rgb[row + sx * 3 + c];
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x * 3 + c] = acc * inv;
        const addX = clampIndex(x + radius + 1, w);
        const subX = clampIndex(x - radius, w);
        acc += rgb[row + addX * 3 + c] - rgb[row + subX * 3 + c];
      }
    }
  }

  // Vertical pass: tmp -> out.
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clampIndex(k, h);
        acc += tmp[(sy * w + x) * 3 + c];
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = acc * inv;
        const addY = clampIndex(y + radius + 1, h);
        const subY = clampIndex(y - radius, h);
        acc += tmp[(addY * w + x) * 3 + c] - tmp[(subY * w + x) * 3 + c];
      }
    }
  }

  return out;
}

function clampIndex(i: number, n: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}

/** Snap a height in [0, maxHeight] to one of `levels` evenly spaced steps, each
 *  itself rounded to a layerHeight multiple. */
function makeQuantizedLevels(maxHeight: number, layerHeight: number, levels: number): Float32Array {
  const n = Math.max(1, Math.floor(levels));
  const out = new Float32Array(n);
  const lh = layerHeight > 0 ? layerHeight : 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let h = t * maxHeight;
    if (lh > 0) h = Math.round(h / lh) * lh;
    out[i] = h;
  }
  return out;
}

function quantizeHeight(h: number, levels: Float32Array, maxHeight: number): number {
  const n = levels.length;
  if (n <= 1) return levels[0] ?? 0;
  const t = maxHeight > 0 ? h / maxHeight : 0;
  let i = Math.round(t * (n - 1));
  if (i < 0) i = 0;
  else if (i >= n) i = n - 1;
  return levels[i];
}

/**
 * Sample an image into a quantized height grid. See module / type docs for the
 * per-mode mapping; `ai` mode reuses the luminance path (the AI only chooses
 * options upstream).
 */
export function sampleImageToGrid(image: ImageData, opts: ReliefOptions): HeightGrid {
  const { resolution, smoothing, maxHeight, layerHeight } = opts.common;
  const ds = downsample(image, resolution, cropToPixels(image, opts.crop) ?? undefined);
  preprocessRgb(ds.rgb, ds.width, ds.height, opts.preprocess);
  const rgb = blurRGB(ds.rgb, ds.width, ds.height, smoothing);
  const w = ds.width;
  const h = ds.height;
  const count = w * h;

  if (opts.mode === 'quantized') {
    return sampleQuantized(rgb, w, h, opts);
  }

  // Luminance (and AI) mode.
  const { invert, gamma } = opts.luminance;
  const levels = makeQuantizedLevels(maxHeight, layerHeight, opts.luminance.levels);
  const heights = new Float32Array(count);
  const g = gamma > 0 ? gamma : 1;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    let l = luminance255(rgb[o], rgb[o + 1], rgb[o + 2]) / 255;
    if (invert) l = 1 - l;
    if (g !== 1) l = Math.pow(l, g);
    heights[i] = quantizeHeight(l * maxHeight, levels, maxHeight);
  }

  // Zero out background cells so they print as base only.
  if (opts.common.removeBackground) {
    const colorsU8 = new Uint8Array(count * 3);
    for (let i = 0; i < count * 3; i++) colorsU8[i] = clamp255(rgb[i]);
    const bgMask = pickBackgroundMask(colorsU8, image, w, h, cropToPixels(image, opts.crop) ?? undefined);
    for (let i = 0; i < count; i++) {
      if (bgMask[i] === 0) heights[i] = 0;
    }
  }

  return { width: w, height: h, heights };
}

function clamp255(v: number): number {
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

// sRGB byte triple -> CIE L*a*b*, for perceptual clustering (the 'lab' option).
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Small deterministic PRNG so a given image always quantizes the same way.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ClusterResult {
  assign: Int32Array;   // cluster index per cell
  repRGB: Float32Array; // k*3 mean sRGB (0..255) per cluster
  k: number;
}

/** K-means (k-means++ seeding + Lloyd iterations) over `feat` (count*3 in the
 *  chosen colour space). Unlike median-cut it places centres at the image's
 *  actual colour modes, so small-but-distinct colours (e.g. black eyes on a
 *  yellow face) keep their own cluster instead of being averaged away. Each
 *  cluster's representative is the MEAN sRGB of its members (from the original
 *  pixels, so 'lab' clustering doesn't drift the displayed colour). */
function kmeansCluster(feat: Float32Array, rgb: Float32Array, count: number, k: number, iters: number): ClusterResult {
  const kk = Math.max(1, Math.min(k, count));
  const rand = mulberry32(0x9e3779b9);
  const cx = new Float32Array(kk * 3);

  // k-means++ seeding: first centre random, each next chosen with probability
  // proportional to squared distance from the nearest existing centre.
  const f0 = Math.floor(rand() * count);
  cx[0] = feat[f0 * 3]; cx[1] = feat[f0 * 3 + 1]; cx[2] = feat[f0 * 3 + 2];
  const nearest2 = new Float32Array(count).fill(Infinity);
  for (let c = 1; c < kk; c++) {
    const px = cx[(c - 1) * 3], py = cx[(c - 1) * 3 + 1], pz = cx[(c - 1) * 3 + 2];
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const dx = feat[i * 3] - px, dy = feat[i * 3 + 1] - py, dz = feat[i * 3 + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearest2[i]) nearest2[i] = d;
      sum += nearest2[i];
    }
    let target = rand() * sum, pick = count - 1;
    for (let i = 0; i < count; i++) { target -= nearest2[i]; if (target <= 0) { pick = i; break; } }
    cx[c * 3] = feat[pick * 3]; cx[c * 3 + 1] = feat[pick * 3 + 1]; cx[c * 3 + 2] = feat[pick * 3 + 2];
  }

  const assign = new Int32Array(count);
  const sumF = new Float64Array(kk * 3);
  const cnt = new Int32Array(kk);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < count; i++) {
      const fx = feat[i * 3], fy = feat[i * 3 + 1], fz = feat[i * 3 + 2];
      let bc = 0, bd = Infinity;
      for (let c = 0; c < kk; c++) {
        const dx = fx - cx[c * 3], dy = fy - cx[c * 3 + 1], dz = fz - cx[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; bc = c; }
      }
      if (assign[i] !== bc) { assign[i] = bc; moved++; }
    }
    sumF.fill(0); cnt.fill(0);
    for (let i = 0; i < count; i++) {
      const c = assign[i];
      sumF[c * 3] += feat[i * 3]; sumF[c * 3 + 1] += feat[i * 3 + 1]; sumF[c * 3 + 2] += feat[i * 3 + 2];
      cnt[c]++;
    }
    for (let c = 0; c < kk; c++) {
      if (cnt[c] === 0) continue;
      cx[c * 3] = sumF[c * 3] / cnt[c];
      cx[c * 3 + 1] = sumF[c * 3 + 1] / cnt[c];
      cx[c * 3 + 2] = sumF[c * 3 + 2] / cnt[c];
    }
    if (it > 0 && moved === 0) break;
  }

  const repSum = new Float64Array(kk * 3);
  const repCnt = new Int32Array(kk);
  for (let i = 0; i < count; i++) {
    const c = assign[i];
    repSum[c * 3] += rgb[i * 3]; repSum[c * 3 + 1] += rgb[i * 3 + 1]; repSum[c * 3 + 2] += rgb[i * 3 + 2];
    repCnt[c]++;
  }
  const repRGB = new Float32Array(kk * 3);
  for (let c = 0; c < kk; c++) {
    const n = repCnt[c] || 1;
    repRGB[c * 3] = repSum[c * 3] / n;
    repRGB[c * 3 + 1] = repSum[c * 3 + 1] / n;
    repRGB[c * 3 + 2] = repSum[c * 3 + 2] / n;
  }
  return { assign, repRGB, k: kk };
}

/** Quantize an sRGB image (byte triples, length `count*3`) to `k` colour
 *  clusters via the shared k-means above. Returns the per-cell cluster index
 *  and each cluster's representative sRGB (0..255). `colorSpace: 'lab'`
 *  clusters perceptually; `'rgb'` clusters in raw sRGB. Shared by the relief
 *  colour pipeline and the image→voxel posterize option. */
export function quantizeColors(
  rgb: Float32Array | Uint8Array | Uint8ClampedArray,
  count: number,
  k: number,
  colorSpace: 'rgb' | 'lab',
): ClusterResult {
  const src = rgb instanceof Float32Array ? rgb : Float32Array.from(rgb);
  const feat = new Float32Array(count * 3);
  if (colorSpace === 'lab') {
    for (let i = 0; i < count; i++) {
      const L = rgbToLab(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      feat[i * 3] = L[0]; feat[i * 3 + 1] = L[1]; feat[i * 3 + 2] = L[2];
    }
  } else {
    feat.set(src);
  }
  return kmeansCluster(feat, src, count, Math.max(1, Math.floor(k)), 16);
}

/** Index of the palette entry (feature triples in the same colour space as the
 *  query) closest to `(fr,fg,fb)` by squared distance. Shared by the relief
 *  dithering path and the image→voxel fixed-palette snapping. */
export function nearestPalette(fr: number, fg: number, fb: number, palFeat: Array<[number, number, number]>): number {
  let best = 0, bd = Infinity;
  for (let c = 0; c < palFeat.length; c++) {
    const dx = fr - palFeat[c][0], dy = fg - palFeat[c][1], dz = fb - palFeat[c][2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function sampleQuantized(rgb: Float32Array, w: number, h: number, opts: ReliefOptions): HeightGrid {
  const count = w * h;
  const { maxHeight, layerHeight } = opts.common;
  const lab = opts.quantized.colorSpace === 'lab';
  const k = Math.max(2, Math.floor(opts.quantized.clusters));

  // Cluster in the chosen colour space (shared with image→voxel posterize).
  const { assign, repRGB, k: kk } = quantizeColors(rgb, count, k, lab ? 'lab' : 'rgb');

  // Representative sRGB palette + per-cluster height. Clusters are ordered by
  // luminance and given evenly spaced heights snapped to layer multiples, so
  // each colour reads as one clean flat terrace (darkest sits lowest).
  const palette: Array<[number, number, number]> = [];
  for (let c = 0; c < kk; c++) palette.push([clamp255(repRGB[c * 3]), clamp255(repRGB[c * 3 + 1]), clamp255(repRGB[c * 3 + 2])]);
  const order = palette.map((_, i) => i).sort((a, b) => luminance255(palette[a][0], palette[a][1], palette[a][2]) - luminance255(palette[b][0], palette[b][1], palette[b][2]));
  // `invertHeights` flips the cluster → height map so DARKER colours land
  // TALLER. Useful when an image's background is the lightest cluster: with
  // the default (bright = tall) the background protrudes above the subject
  // and occludes it from a top-down view, exactly the bug we're working
  // around here.
  if (opts.quantized.invertHeights) order.reverse();
  const lh = layerHeight > 0 ? layerHeight : 0;
  const clusterHeight = new Float32Array(kk);
  for (let s = 0; s < kk; s++) {
    const t = kk === 1 ? 0 : s / (kk - 1);
    let z = t * maxHeight;
    if (lh > 0) z = Math.round(z / lh) * lh;
    clusterHeight[order[s]] = z;
  }

  const heights = new Float32Array(count);
  const colors = new Uint8Array(count * 3);

  if (opts.quantized.dither) {
    // Floyd–Steinberg over a working copy: choose the nearest palette colour in
    // the clustering space, diffuse the sRGB error to neighbours.
    const palFeat: Array<[number, number, number]> = palette.map(p => (lab ? rgbToLab(p[0], p[1], p[2]) : [p[0], p[1], p[2]]));
    const work = Float32Array.from(rgb);
    const diffuse = (x: number, y: number, er: number, eg: number, eb: number, f: number) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const o = (y * w + x) * 3;
      work[o] += er * f; work[o + 1] += eg * f; work[o + 2] += eb * f;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, o = i * 3;
        const r = work[o], g = work[o + 1], b = work[o + 2];
        const fl = lab ? rgbToLab(r, g, b) : null;
        const ci = fl ? nearestPalette(fl[0], fl[1], fl[2], palFeat) : nearestPalette(r, g, b, palFeat);
        const c = palette[ci];
        heights[i] = clusterHeight[ci];
        colors[o] = c[0]; colors[o + 1] = c[1]; colors[o + 2] = c[2];
        const er = r - c[0], eg = g - c[1], eb = b - c[2];
        diffuse(x + 1, y, er, eg, eb, 7 / 16);
        diffuse(x - 1, y + 1, er, eg, eb, 3 / 16);
        diffuse(x, y + 1, er, eg, eb, 5 / 16);
        diffuse(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      const c = assign[i];
      heights[i] = clusterHeight[c];
      const p = palette[c];
      colors[i * 3] = p[0]; colors[i * 3 + 1] = p[1]; colors[i * 3 + 2] = p[2];
    }
  }

  return { width: w, height: h, heights, colors };
}

/**
 * The two top-surface triangle ids for grid cell (x,y). Top triangles are
 * emitted first in `triVerts`, scanned cell-major (y outer, x inner), 2 per
 * cell, so cell (x,y) owns triangles [2*q, 2*q+1] where q = y*(W-1)+x.
 */
export function gridTriangleIndexForCell(grid: HeightGrid, x: number, y: number): [number, number] {
  const quadsPerRow = grid.width - 1;
  const q = y * quadsPerRow + x;
  return [2 * q, 2 * q + 1];
}

/**
 * Build a closed, edge-manifold solid from a height grid. Triangle order:
 *   1. top surface  (cell-major, 2 tris/cell, +Z normals)
 *   2. bottom plane (cell-major, 2 tris/cell, -Z normals)
 *   3. skirt walls  (-Y, +X, +Y, -X borders), reusing the top & bottom border
 *      vertices so every border edge is shared by exactly two triangles.
 */
export function buildReliefMesh(grid: HeightGrid, opts: ReliefOptions): ReliefMesh {
  const W = grid.width;
  const H = grid.height;
  const base = opts.common.baseThickness;
  const widthMm = opts.common.widthMm;
  const heightMm = widthMm * (H / W);

  const cols = W - 1; // quad columns
  const rows = H - 1; // quad rows
  const numVert = 2 * W * H; // top grid + bottom grid
  // Tris: top (2/cell) + bottom (2/cell) + 4 walls (2/border-segment).
  const numTri = 2 * cols * rows * 2 + 4 * (cols + rows);

  const vertProperties = new Float32Array(numVert * 3);
  const triVerts = new Uint32Array(numTri * 3);

  // Position both vertex grids. World placement: centered on XY origin, Z up.
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const dx = W > 1 ? widthMm / (W - 1) : 0;
  const dy = H > 1 ? heightMm / (H - 1) : 0;
  const topBase = W * H * 3; // byte-free offset (in floats) to bottom grid

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      const px = -halfW + x * dx;
      const py = -halfH + y * dy;
      const topZ = base + grid.heights[cell];
      const t = cell * 3;
      vertProperties[t] = px;
      vertProperties[t + 1] = py;
      vertProperties[t + 2] = topZ;
      const b = topBase + cell * 3;
      vertProperties[b] = px;
      vertProperties[b + 1] = py;
      vertProperties[b + 2] = 0;
    }
  }

  const topIdx = (x: number, y: number) => y * W + x;
  const botIdx = (x: number, y: number) => W * H + y * W + x;

  let ti = 0; // running triangle-vertex write cursor (in indices)
  const tri = (a: number, b: number, c: number) => {
    triVerts[ti] = a;
    triVerts[ti + 1] = b;
    triVerts[ti + 2] = c;
    ti += 3;
  };

  // 1. Top surface — CCW seen from +Z (normals up). Cell-major to match
  //    gridTriangleIndexForCell.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = topIdx(x, y);
      const b = topIdx(x + 1, y);
      const c = topIdx(x + 1, y + 1);
      const d = topIdx(x, y + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  }

  // 2. Bottom plane at z=0 — CCW seen from -Z (normals down): reverse winding.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = botIdx(x, y);
      const b = botIdx(x + 1, y);
      const c = botIdx(x + 1, y + 1);
      const d = botIdx(x, y + 1);
      tri(a, c, b);
      tri(a, d, c);
    }
  }

  // 3. Skirt walls. Each border segment makes a quad (two top verts over two
  //    bottom verts); winding chosen so the normal points outward.
  //    -Y border (y=0): outward normal -Y.
  for (let x = 0; x < cols; x++) {
    const t0 = topIdx(x, 0);
    const t1 = topIdx(x + 1, 0);
    const b0 = botIdx(x, 0);
    const b1 = botIdx(x + 1, 0);
    tri(t0, b0, b1);
    tri(t0, b1, t1);
  }
  // +Y border (y=H-1): outward normal +Y.
  for (let x = 0; x < cols; x++) {
    const t0 = topIdx(x, H - 1);
    const t1 = topIdx(x + 1, H - 1);
    const b0 = botIdx(x, H - 1);
    const b1 = botIdx(x + 1, H - 1);
    tri(t0, t1, b1);
    tri(t0, b1, b0);
  }
  // -X border (x=0): outward normal -X.
  for (let y = 0; y < rows; y++) {
    const t0 = topIdx(0, y);
    const t1 = topIdx(0, y + 1);
    const b0 = botIdx(0, y);
    const b1 = botIdx(0, y + 1);
    tri(t0, t1, b1);
    tri(t0, b1, b0);
  }
  // +X border (x=W-1): outward normal +X.
  for (let y = 0; y < rows; y++) {
    const t0 = topIdx(W - 1, y);
    const t1 = topIdx(W - 1, y + 1);
    const b0 = botIdx(W - 1, y);
    const b1 = botIdx(W - 1, y + 1);
    tri(t0, b0, b1);
    tri(t0, b1, t1);
  }

  const watertight = isEdgeManifold(triVerts, ti / 3);

  return {
    vertProperties,
    triVerts,
    numVert,
    numTri,
    numProp: 3,
    watertight,
  };
}

/** Edge-manifold check: every undirected edge must be shared by exactly two
 *  triangles. This is exactly Manifold.ofMesh's topological precondition. */
function isEdgeManifold(triVerts: Uint32Array, numTri: number): boolean {
  const counts = new Map<number, number>();
  // Encode an undirected edge (min,max) as a single number. Vertex ids fit well
  // within 2^26 for any plausible relief, so a 2^26 multiplier stays exact in a
  // double and avoids string-key allocation per edge.
  const MUL = 1 << 26;
  const bump = (u: number, v: number) => {
    const a = u < v ? u : v;
    const b = u < v ? v : u;
    const key = a * MUL + b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3];
    const b = triVerts[t * 3 + 1];
    const c = triVerts[t * 3 + 2];
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  for (const count of counts.values()) {
    if (count !== 2) return false;
  }
  return true;
}

/**
 * Sample + build in one call. In `quantized` mode also returns one SeedRegion
 * per cluster listing the top-surface triangle ids of that cluster's cells
 * (color 0..1), so the caller can pre-paint the relief. Luminance/AI modes
 * return no seedRegions.
 */
export function generateRelief(image: ImageData, opts: ReliefOptions = DEFAULT_RELIEF_OPTIONS): GenerateReliefResult {
  const grid = sampleImageToGrid(image, opts);

  // Tile outputs (flat / silhouette) skip the heightmap relief mesh and build
  // a flat tile of constant thickness instead, painting colour clusters onto
  // its top face — the keychain workflow. Only applies to quantized mode
  // (luminance is always a heightmap).
  if (opts.mode === 'quantized' && grid.colors && opts.quantized.output !== 'relief') {
    return buildQuantizedTile(grid, opts, image);
  }

  // For stepped relief with removeBackground, zero out height for background
  // cells so they print as the base only (no raised colour terrace).
  if (opts.common.removeBackground && opts.mode === 'quantized' && grid.colors) {
    const cropPx = cropToPixels(image, opts.crop) ?? undefined;
    const bgMask = pickBackgroundMask(grid.colors, image, grid.width, grid.height, cropPx);
    for (let i = 0; i < grid.heights.length; i++) {
      if (bgMask[i] === 0) grid.heights[i] = 0;
    }
  }

  // Stepped relief (both painting modes) uses the continuous height-grid mesh.
  // It is a closed 2-manifold (verified by isEdgeManifold inside
  // buildReliefMesh) so it slices and prints; an earlier experiment that built
  // per-cell boxes with subdivided vertical walls produced crisper colour
  // steps in the preview but was NOT watertight on detailed images (vertical
  // corner T-junctions where cells of 3-4 different heights meet), so a slicer
  // rejected it as non-manifold. The continuous mesh is the correct geometry
  // for a single-nozzle print regardless: at any Z slice only the regions tall
  // enough are present, so each printed layer is a single filament when the
  // user follows the height-based swap guide. Each cell's flat top is painted
  // with its own cluster colour (seedRegionsFromReliefGrid); the only soft
  // edges are the one-cell-wide ramps at colour boundaries, far below a
  // print layer's footprint at normal resolution.
  const mesh = buildReliefMesh(grid, opts);
  if (opts.mode !== 'quantized' || !grid.colors) {
    return { mesh, grid };
  }
  const seedRegions = seedRegionsFromReliefGrid(grid);
  return { mesh, grid, seedRegions };
}

/** Build the flat colour-tile result for quantized mode with output !== 'relief'. */
function buildQuantizedTile(grid: HeightGrid, opts: ReliefOptions, sourceImage?: ImageData): GenerateReliefResult {
  const colors = grid.colors!;
  const W = grid.width, H = grid.height;
  const tileOpts: TileOptions = {
    widthMm: opts.common.widthMm,
    thickness: opts.common.baseThickness + opts.common.maxHeight,
    holes: opts.quantized.holes,
    chamferMm: opts.quantized.chamferMm,
  };

  // Compute the base shape for the tile.
  let shape: TileShape = opts.quantized.output === 'silhouette'
    ? {
        kind: 'mask',
        mask: opts.quantized.manualBackground
          ? bgMaskFromColor(colors, W, H, opts.quantized.manualBackground)
          : detectBackgroundMask(colors, W, H),
      }
    : opts.quantized.shape === 'rounded'
      ? { kind: 'rounded', cornerRadiusMm: opts.quantized.cornerRadiusMm }
      : opts.quantized.shape === 'circle'
        ? { kind: 'circle' }
        : { kind: 'rect' };

  // When removeBackground is on for a non-silhouette tile, detect the
  // background and intersect it with the existing shape mask so background
  // pixels are cut out of even rect/rounded/circle tiles.
  if (opts.common.removeBackground && opts.quantized.output !== 'silhouette') {
    const fgMask = pickBackgroundMask(colors, sourceImage ?? null, W, H);
    const shapeMask = buildCellMask(W, H, tileOpts, shape);
    const combined = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) combined[i] = shapeMask[i] & fgMask[i];
    shape = { kind: 'mask', mask: combined };
  }

  const { mesh, cellTriIds, cellTriIdsBottom } = buildTileMesh(W, H, tileOpts, shape);
  const seedRegions = seedRegionsFromCellGrid(colors, cellTriIds, W, H);

  // Double-sided: paint the bottom face too, using mirrored or same colors.
  if (opts.quantized.doubleSided && opts.quantized.output === 'flat') {
    const mirror = opts.quantized.backMirror !== false;
    const bottomRegions = seedRegionsFromCellGridBottom(colors, cellTriIdsBottom, W, H, mirror);
    return { mesh, grid, seedRegions: mergeRegions(seedRegions, bottomRegions) };
  }

  return { mesh, grid, seedRegions };
}

/** Stepped-relief variant: each cell owns the two top triangles emitted by
 *  buildReliefMesh in cell-major order (see gridTriangleIndexForCell). */
function seedRegionsFromReliefGrid(grid: HeightGrid): SeedRegion[] {
  const colors = grid.colors!;
  const byColor = new Map<number, { color: [number, number, number]; triangleIds: number[] }>();
  for (let y = 0; y < grid.height - 1; y++) {
    for (let x = 0; x < grid.width - 1; x++) {
      const cell = y * grid.width + x;
      const r = colors[cell * 3], g = colors[cell * 3 + 1], b = colors[cell * 3 + 2];
      const key = (r << 16) | (g << 8) | b;
      let bucket = byColor.get(key);
      if (!bucket) { bucket = { color: [r / 255, g / 255, b / 255], triangleIds: [] }; byColor.set(key, bucket); }
      const [t0, t1] = gridTriangleIndexForCell(grid, x, y);
      bucket.triangleIds.push(t0, t1);
    }
  }
  return mapBucketsToRegions(byColor);
}

// (seedRegionsByZBand removed — buildSteppedReliefMesh now produces stepped
//  geometry whose triangles are Z-banded by construction, so we don't have to
//  retro-fit colours onto a slanted continuous mesh.)

/** Tile variant: cellTriIds carries -1 for excluded cells (shape/hole/edge),
 *  so only included cells contribute. Top-face (CCW from +Z). */
function seedRegionsFromCellGrid(colors: Uint8Array, cellTriIds: Int32Array, W: number, H: number): SeedRegion[] {
  const byColor = new Map<number, { color: [number, number, number]; triangleIds: number[] }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      const t0 = cellTriIds[cell * 2];
      if (t0 < 0) continue;
      const r = colors[cell * 3], g = colors[cell * 3 + 1], b = colors[cell * 3 + 2];
      const key = (r << 16) | (g << 8) | b;
      let bucket = byColor.get(key);
      if (!bucket) { bucket = { color: [r / 255, g / 255, b / 255], triangleIds: [] }; byColor.set(key, bucket); }
      bucket.triangleIds.push(t0, cellTriIds[cell * 2 + 1]);
    }
  }
  return mapBucketsToRegions(byColor);
}

/** Bottom-face variant for double-sided tiles. When `mirror` is true, cell
 *  (x, y) on the bottom takes its colour from (W-1-x, y) on the image so the
 *  tile looks identical from both sides when flipped. */
function seedRegionsFromCellGridBottom(
  colors: Uint8Array,
  cellTriIdsBottom: Int32Array,
  W: number,
  H: number,
  mirror: boolean,
): SeedRegion[] {
  const byColor = new Map<number, { color: [number, number, number]; triangleIds: number[] }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      const t0 = cellTriIdsBottom[cell * 2];
      if (t0 < 0) continue;
      const srcX = mirror ? W - 1 - x : x;
      const src = y * W + srcX;
      const r = colors[src * 3], g = colors[src * 3 + 1], b = colors[src * 3 + 2];
      const key = (r << 16) | (g << 8) | b;
      let bucket = byColor.get(key);
      if (!bucket) { bucket = { color: [r / 255, g / 255, b / 255], triangleIds: [] }; byColor.set(key, bucket); }
      bucket.triangleIds.push(t0, cellTriIdsBottom[cell * 2 + 1]);
    }
  }
  return mapBucketsToRegions(byColor);
}

/** Merge two sets of seed regions, combining triangle lists for matching colours. */
function mergeRegions(a: SeedRegion[], b: SeedRegion[]): SeedRegion[] {
  const byKey = new Map<number, SeedRegion>();
  for (const r of a) {
    const k = (Math.round(r.color[0] * 255) << 16) | (Math.round(r.color[1] * 255) << 8) | Math.round(r.color[2] * 255);
    byKey.set(k, { ...r, triangleIds: [...r.triangleIds] });
  }
  for (const r of b) {
    const k = (Math.round(r.color[0] * 255) << 16) | (Math.round(r.color[1] * 255) << 8) | Math.round(r.color[2] * 255);
    const existing = byKey.get(k);
    if (existing) existing.triangleIds.push(...r.triangleIds);
    else byKey.set(k, { ...r, triangleIds: [...r.triangleIds] });
  }
  return Array.from(byKey.values());
}

function mapBucketsToRegions(byColor: Map<number, { color: [number, number, number]; triangleIds: number[] }>): SeedRegion[] {
  const seedRegions: SeedRegion[] = [];
  let i = 0;
  for (const bucket of byColor.values()) {
    seedRegions.push({ color: bucket.color, triangleIds: bucket.triangleIds, name: `Region ${++i}` });
  }
  return seedRegions;
}

/**
 * Downsample the alpha channel of an ImageData to (targetW × targetH) using
 * the same box-average + Y-flip as downsample() so the result aligns with the
 * colour grid. Returns null when the image is fully opaque (no cell has mean
 * alpha < 128), signalling that colour-based detection should be used instead.
 * Otherwise returns a 0/1 mask: 1 = foreground (alpha ≥ 128), 0 = background.
 */
function tryAlphaBasedMask(
  image: ImageData,
  targetW: number,
  targetH: number,
  cropPx?: { left: number; top: number; right: number; bottom: number },
): Uint8Array | null {
  const imgW = image.width, imgH = image.height;
  const cl = cropPx ? Math.max(0, Math.floor(cropPx.left)) : 0;
  const ct = cropPx ? Math.max(0, Math.floor(cropPx.top)) : 0;
  const cr = cropPx ? Math.min(imgW, Math.floor(cropPx.right)) : imgW;
  const cb = cropPx ? Math.min(imgH, Math.floor(cropPx.bottom)) : imgH;
  const srcW = Math.max(1, cr - cl), srcH = Math.max(1, cb - ct);
  const src = image.data;
  const count = targetW * targetH;
  const avgAlpha = new Float32Array(count);

  for (let cy = 0; cy < targetH; cy++) {
    const fcy = targetH - 1 - cy; // Y-flip: grid row 0 = image bottom
    const y0 = ct + Math.floor((fcy * srcH) / targetH);
    const y1 = Math.max(y0 + 1, ct + Math.floor(((fcy + 1) * srcH) / targetH));
    for (let cx = 0; cx < targetW; cx++) {
      const x0 = cl + Math.floor((cx * srcW) / targetW);
      const x1 = Math.max(x0 + 1, cl + Math.floor(((cx + 1) * srcW) / targetW));
      let sum = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          sum += src[(sy * imgW + sx) * 4 + 3];
          n++;
        }
      }
      avgAlpha[cy * targetW + cx] = n > 0 ? sum / n : 255;
    }
  }

  // Return null (fall through to colour detection) if the image is fully opaque.
  let hasTransparent = false;
  for (let i = 0; i < count; i++) {
    if (avgAlpha[i] < 128) { hasTransparent = true; break; }
  }
  if (!hasTransparent) return null;

  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) mask[i] = avgAlpha[i] >= 128 ? 1 : 0;
  return mask;
}

/**
 * Pick the best available background mask: alpha channel (if the image has
 * transparency), otherwise border-colour detection on the downsampled RGB.
 */
function pickBackgroundMask(
  colors: Uint8Array,
  image: ImageData | null,
  w: number,
  h: number,
  cropPx?: { left: number; top: number; right: number; bottom: number },
): Uint8Array {
  if (image) {
    const alphaMask = tryAlphaBasedMask(image, w, h, cropPx);
    if (alphaMask) return alphaMask;
  }
  return detectBackgroundMask(colors, w, h);
}

/** Approximate background detection: the dominant exact colour on the image
 *  border is treated as background. Returns a per-cell mask where 1 = subject
 *  (keep) and 0 = background (cut from the tile silhouette). Works well for
 *  the common case of a subject on a roughly-uniform-colour backdrop.
 *
 *  When no border colour clearly dominates (busy photo edges, no single bg),
 *  falls back to keeping every cell — better to ship the full tile than to
 *  silently cut into the subject. */
/** Mask-from-explicit-colour: 1 for any cell whose RGB is NOT within
 *  `tolerance` (sum-of-squared-distance) of the target colour. Used by the
 *  click-to-pick-background flow so the user can override the auto heuristic. */
export function bgMaskFromColor(colors: Uint8Array, w: number, h: number, bg: [number, number, number], tolerance = 36 * 36 * 3): Uint8Array {
  const total = w * h;
  const out = new Uint8Array(total);
  const br = bg[0], bgg = bg[1], bb = bg[2];
  for (let i = 0; i < total; i++) {
    const o = i * 3;
    const dr = colors[o] - br;
    const dg = colors[o + 1] - bgg;
    const db = colors[o + 2] - bb;
    out[i] = dr * dr + dg * dg + db * db > tolerance ? 1 : 0;
  }
  return out;
}

export function detectBackgroundMask(colors: Uint8Array, w: number, h: number): Uint8Array {
  const total = w * h;
  const keyOf = (cell: number) =>
    (colors[cell * 3] << 16) | (colors[cell * 3 + 1] << 8) | colors[cell * 3 + 2];
  const counts = new Map<number, number>();
  const bump = (cell: number) => counts.set(keyOf(cell), (counts.get(keyOf(cell)) ?? 0) + 1);
  for (let x = 0; x < w; x++) { bump(x); bump((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { bump(y * w); bump(y * w + (w - 1)); }
  let bgKey = -1, bgCount = 0;
  for (const [k, n] of counts) { if (n > bgCount) { bgCount = n; bgKey = k; } }
  const borderTotal = Math.max(1, 2 * (w + h) - 4);
  // Dominance threshold: the leading border colour must cover >=35% of the
  // border to be treated as background. Below that, the image probably has no
  // clean backdrop (a photo with subject touching an edge, or a busy collage)
  // and silhouette-cutting it would lop into the subject — keep the full tile.
  if (bgCount / borderTotal < 0.35) {
    const full = new Uint8Array(total);
    full.fill(1);
    return full;
  }
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) mask[i] = keyOf(i) === bgKey ? 0 : 1;
  return mask;
}

/** Build a tile from raw SVG text. Each unique fill colour becomes one seed
 *  region with crisp boundaries (no clustering — the SVG already has discrete
 *  fills). Honours opts.quantized.output/shape/hole for the tile geometry:
 *  silhouette uses the union of all fills, flat/relief use the explicit shape. */
export async function generateReliefFromSvg(svgText: string, opts: ReliefOptions): Promise<GenerateReliefResult> {
  const resolution = Math.max(8, Math.min(256, Math.floor(opts.common.resolution)));
  const parsed = await parseSvgToTile(svgText, resolution);
  const W = parsed.width, H = parsed.height;
  const thickness = opts.common.baseThickness + opts.common.maxHeight;

  // Compose a flat colours grid by painting fills in SVG document order
  // (later fills cover earlier where masks overlap).
  const colorsBytes = new Uint8Array(W * H * 3);
  for (const fill of parsed.fills) {
    const r = Math.round(fill.color[0] * 255);
    const g = Math.round(fill.color[1] * 255);
    const b = Math.round(fill.color[2] * 255);
    const mask = fill.mask;
    for (let i = 0; i < W * H; i++) {
      if (mask[i]) { colorsBytes[i * 3] = r; colorsBytes[i * 3 + 1] = g; colorsBytes[i * 3 + 2] = b; }
    }
  }
  const heights = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) heights[i] = parsed.unionMask[i] ? thickness : 0;
  const grid: HeightGrid = { width: W, height: H, heights, colors: colorsBytes };

  // Tile shape: 'silhouette' uses the SVG's union mask (an SVG-shaped tile);
  // otherwise honour the explicit rect/rounded/circle pick.
  const tileOpts: TileOptions = {
    widthMm: opts.common.widthMm,
    thickness,
    holes: opts.quantized.holes,
    chamferMm: opts.quantized.chamferMm,
  };
  const shape: TileShape = opts.quantized.output === 'silhouette'
    ? { kind: 'mask', mask: parsed.unionMask }
    : opts.quantized.shape === 'rounded'
      ? { kind: 'rounded', cornerRadiusMm: opts.quantized.cornerRadiusMm }
      : opts.quantized.shape === 'circle'
        ? { kind: 'circle' }
        : { kind: 'rect' };
  const { mesh, cellTriIds } = buildTileMesh(W, H, tileOpts, shape);

  // Seed regions directly from each parsed fill mask — crisp, no clustering.
  const seedRegions: SeedRegion[] = parsed.fills.map((fill, idx) => {
    const triangleIds: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!fill.mask[i]) continue;
      const t0 = cellTriIds[i * 2];
      if (t0 < 0) continue;
      triangleIds.push(t0, cellTriIds[i * 2 + 1]);
    }
    return { color: fill.color, triangleIds, name: `Fill ${idx + 1}` };
  }).filter(r => r.triangleIds.length > 0);
  return { mesh, grid, seedRegions };
}
