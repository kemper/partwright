// Image → voxel grid conversion. Turns a raster image (logo, sprite,
// pixel-art, small photo) into a standing billboard of colored voxels, then
// emits runnable editor code that rebuilds it via `voxels.decode(...)`.
//
// The pure conversion + codegen live here (unit-testable with a synthetic
// ImageData); the DOM step that turns a `File` into pixels lives in main.ts.

import { VoxelGrid, encodeGrid, COORD_MIN, COORD_MAX } from '../geometry/voxel/grid';
import { preprocessRgb, quantizeColors, detectBackgroundMask, bgMaskFromColor, rgbToLab, nearestPalette } from '../relief/imageToRelief';

/** Minimal shape of the browser `ImageData` we consume (also satisfiable by a
 *  plain object in tests). */
export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA bytes, row-major, length `width * height * 4`. */
  data: Uint8ClampedArray | Uint8Array | number[];
}

/** How the image's pixels are turned into voxel depth along +Y.
 *  - `billboard`: every surviving pixel becomes a flat column of `depth`
 *    voxels — a standing colored picture (the original behavior).
 *  - `heightmap`: each pixel's brightness drives a per-column height, so
 *    the image becomes a relief/lithophane-style 3D surface. */
export type ImageVoxelMode = 'billboard' | 'heightmap';

/** How surviving pixels are colored.
 *  - `original`: keep each pixel's RGB.
 *  - `grayscale`: replace with its luminance (handy for heightmaps).
 *  - `flat`: paint every voxel a single `flatColor`. */
export type ImageVoxelColorMode = 'original' | 'grayscale' | 'flat';

export interface ImageToVoxelOptions {
  /** Longest side after downsampling. The grid axis range caps this anyway. */
  maxSize?: number;
  /** Conversion mode (default `billboard`). */
  mode?: ImageVoxelMode;
  /** Billboard mode: how many voxels deep to extrude the image along Y. */
  depth?: number;
  /** Heightmap mode: the tallest a pixel's relief can reach (voxels along Y). */
  maxHeight?: number;
  /** Heightmap mode: a solid backing slab (voxels along Y) added behind every
   *  surviving pixel, so even the darkest areas stay connected/printable. */
  baseThickness?: number;
  /** Heightmap mode: invert the brightness→height mapping (dark = tall). */
  invert?: boolean;
  /** Minimum alpha (0–255) for a pixel to become a voxel. Lets transparent
   *  PNG/sprite backgrounds drop out; opaque photos become a full slab. */
  alphaThreshold?: number;
  /** How surviving pixels are colored (default `original`). */
  colorMode?: ImageVoxelColorMode;
  /** RGB used when `colorMode` is `flat` (default mid-gray). */
  flatColor?: [number, number, number];
  /** Heightmap mode: gamma applied to normalized brightness before the height
   *  map (after invert). >1 sinks midtones, <1 lifts them. Default 1 (linear). */
  gamma?: number;
  // --- Image adjustments (applied before sampling; all default to no-op) ---
  /** −1..+1, shifts the whole image lighter/darker. 0 = unchanged. */
  brightness?: number;
  /** −1..+1, expands/compresses tonal range around mid-gray. 0 = unchanged. */
  contrast?: number;
  /** −1..+1, pushes color intensity. 0 = unchanged; −1 = fully desaturated. */
  saturation?: number;
  /** Posterize `original` colors to this many clusters (k-means, perceptual).
   *  0 = off (keep per-pixel color). Gives a clean limited voxel-art palette. */
  posterizeColors?: number;
  /** Snap each surviving `original`-mode pixel to the nearest color in this
   *  fixed palette (perceptual / LAB distance). Takes precedence over
   *  `posterizeColors`. Omit / empty / null = keep per-pixel color (or
   *  posterize). Use {@link extractImagePalette} to seed it from the image. */
  palette?: [number, number, number][] | null;
  /** Drop a solid-color background so an opaque photo's subject voxelizes
   *  without its backdrop (the alpha cutoff only catches transparency). */
  removeBackground?: boolean;
  /** Explicit background RGB to remove; when omitted (and `removeBackground`
   *  is on) the dominant border color is auto-detected. */
  backgroundColor?: [number, number, number];
  /** How {@link generateVoxelImportCode} renders the grid: a compact
   *  `voxels.decode("…")` blob (`'decode'`, default) or human-readable
   *  `v.fillBox(…)` / `v.set(…)` builder calls (`'calls'`). Very large or
   *  colorful grids fall back to `'decode'` so the editor stays usable. */
  codeStyle?: 'decode' | 'calls';
}

const DEFAULTS = {
  maxSize: 64,
  mode: 'billboard' as ImageVoxelMode,
  depth: 1,
  maxHeight: 16,
  baseThickness: 1,
  invert: false,
  alphaThreshold: 128,
  colorMode: 'original' as ImageVoxelColorMode,
  flatColor: [180, 180, 180] as [number, number, number],
  gamma: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  posterizeColors: 0,
  removeBackground: false,
};
// Cap so a pathological maxSize can't exceed the grid's coordinate range.
const HARD_MAX = Math.min(256, COORD_MAX - COORD_MIN);
// Cap each Y component (depth, maxHeight, baseThickness) well below the grid's
// coordinate range so even `baseThickness + maxHeight` keeps the tallest voxel
// (y index = height − 1) comfortably within [COORD_MIN, COORD_MAX].
const HARD_MAX_Y = 256;

/** Rec. 601 luma — the perceptual brightness used for the heightmap mapping
 *  and the `grayscale` color mode. Returns 0–255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

interface DownsampledImage {
  tw: number;
  th: number;
  count: number;
  /** Interleaved RGB (length count*3) in a Float32 grid so the relief
   *  preprocessor can operate on it in place. */
  rgb: Float32Array;
  /** Per-pixel alpha (length count); relief is alpha-blind, the voxel cutoff
   *  needs it. */
  alpha: Uint8Array;
}

/** Nearest-neighbor downsample so the image's longest side fits `maxSize`.
 *  Shared by {@link computeImageVoxelLayout} and {@link extractImagePalette} so
 *  a palette seeded from the image matches what the import samples. Returns
 *  null for a degenerate (zero-area) image. */
function downsampleImage(image: ImageDataLike, maxSize: number): DownsampledImage | null {
  const { width: sw, height: sh, data } = image;
  if (sw <= 0 || sh <= 0) return null;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const count = tw * th;
  const rgb = new Float32Array(count * 3);
  const alpha = new Uint8Array(count);
  for (let ty = 0; ty < th; ty++) {
    const sy = Math.min(sh - 1, Math.floor((ty / th) * sh));
    for (let tx = 0; tx < tw; tx++) {
      const sx = Math.min(sw - 1, Math.floor((tx / tw) * sw));
      const p = (sy * sw + sx) * 4;
      const c = ty * tw + tx;
      rgb[c * 3] = data[p];
      rgb[c * 3 + 1] = data[p + 1];
      rgb[c * 3 + 2] = data[p + 2];
      alpha[c] = data[p + 3];
    }
  }
  return { tw, th, count, rgb, alpha };
}

/** Validate + clamp a user-supplied palette to non-empty RGB byte triples, or
 *  null when there's nothing usable. */
function clampPalette(p?: [number, number, number][] | null): [number, number, number][] | null {
  if (!p || !Array.isArray(p) || p.length === 0) return null;
  const out: [number, number, number][] = [];
  for (const c of p) {
    if (!Array.isArray(c) || c.length < 3) continue;
    out.push([clampByte(c[0]), clampByte(c[1]), clampByte(c[2])]);
  }
  return out.length ? out : null;
}

/** One downsampled pixel that survived the alpha test, resolved to a voxel
 *  column: where it sits in the grid, how tall its +Y extrusion is, and the
 *  color every voxel in the column takes. */
export interface VoxelColumn {
  /** Grid coordinates of the column's base voxel. */
  x: number;
  z: number;
  /** Downsampled-image pixel coordinates (origin top-left) — handy for 2D previews. */
  px: number;
  py: number;
  /** Number of voxels stacked along +Y (always ≥ 1). */
  height: number;
  color: [number, number, number];
}

export interface ImageVoxelLayout {
  /** Downsampled image dimensions (also the preview canvas pixel grid). */
  tw: number;
  th: number;
  columns: VoxelColumn[];
  /** Total voxels the grid will contain (columns never overlap, so this is the
   *  sum of column heights). */
  voxelCount: number;
  /** Bounding-box size of the produced voxels, matching the codegen's
   *  `W×H×D` (X×Y×Z) readout. Zeroes when nothing survives. */
  dims: { x: number; y: number; z: number };
}

/** Resolve the image into voxel columns without allocating the grid. This is
 *  the single source of truth for the survive / height / color rules, shared
 *  by `imageDataToVoxelGrid` (which fills a real grid) and the import modal's
 *  live preview (which just draws + counts). */
export function computeImageVoxelLayout(image: ImageDataLike, options: ImageToVoxelOptions = {}): ImageVoxelLayout {
  const maxSize = Math.max(1, Math.min(Math.floor(options.maxSize ?? DEFAULTS.maxSize), HARD_MAX));
  const mode = options.mode ?? DEFAULTS.mode;
  const depth = Math.max(1, Math.min(Math.floor(options.depth ?? DEFAULTS.depth), HARD_MAX_Y));
  const maxHeight = Math.max(1, Math.min(Math.floor(options.maxHeight ?? DEFAULTS.maxHeight), HARD_MAX_Y));
  const baseThickness = Math.max(0, Math.min(Math.floor(options.baseThickness ?? DEFAULTS.baseThickness), HARD_MAX_Y));
  const invert = options.invert ?? DEFAULTS.invert;
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? DEFAULTS.alphaThreshold));
  const colorMode = options.colorMode ?? DEFAULTS.colorMode;
  const flatColor = options.flatColor ?? DEFAULTS.flatColor;
  const gamma = options.gamma ?? DEFAULTS.gamma;
  const brightness = options.brightness ?? DEFAULTS.brightness;
  const contrast = options.contrast ?? DEFAULTS.contrast;
  const saturation = options.saturation ?? DEFAULTS.saturation;
  const posterizeColors = Math.max(0, Math.floor(options.posterizeColors ?? DEFAULTS.posterizeColors));
  const removeBackground = options.removeBackground ?? DEFAULTS.removeBackground;

  // Downsample (nearest-neighbor) so the longest side fits maxSize.
  const ds = downsampleImage(image, maxSize);
  if (!ds) return { tw: 0, th: 0, columns: [], voxelCount: 0, dims: { x: 0, y: 0, z: 0 } };
  const { tw, th, count, rgb, alpha } = ds;

  // Tonal adjustments (brightness / contrast / saturation) — reuses the relief
  // pipeline's pure preprocessor. No-op at defaults (preserves prior output).
  preprocessRgb(rgb, tw, th, { brightness, contrast, saturation, levelsLow: 0, levelsHigh: 255 });

  // Color reduction for `original` mode. A fixed user palette (snap each pixel
  // to its nearest entry, perceptually) takes precedence over posterize (auto
  // k-means clusters). `palette` holds the resolved colors; pixels reach them
  // via `assign` (posterize) or a nearest-LAB lookup over `snapLab` (palette).
  let palette: [number, number, number][] | null = null;
  let assign: Int32Array | null = null;
  let snapLab: [number, number, number][] | null = null;
  const userPalette = clampPalette(options.palette);
  if (colorMode === 'original' && userPalette) {
    palette = userPalette;
    snapLab = userPalette.map(([r, g, b]) => rgbToLab(r, g, b));
  } else if (posterizeColors >= 2 && colorMode === 'original') {
    const r = quantizeColors(rgb, count, posterizeColors, 'lab');
    assign = r.assign;
    palette = [];
    for (let k = 0; k < r.k; k++) {
      palette.push([clampByte(r.repRGB[k * 3]), clampByte(r.repRGB[k * 3 + 1]), clampByte(r.repRGB[k * 3 + 2])]);
    }
  }

  // Optional background removal: drop a solid backdrop the alpha cutoff can't
  // (opaque photos). Reuses the relief background-mask helpers; mask[i]===0 is
  // background. Built from the (already-adjusted) downsampled colors.
  let bgMask: Uint8Array | null = null;
  if (removeBackground) {
    const colorsU8 = new Uint8Array(count * 3);
    for (let i = 0; i < count * 3; i++) colorsU8[i] = clampByte(rgb[i]);
    bgMask = options.backgroundColor
      ? bgMaskFromColor(colorsU8, tw, th, [
          clampByte(options.backgroundColor[0]),
          clampByte(options.backgroundColor[1]),
          clampByte(options.backgroundColor[2]),
        ])
      : detectBackgroundMask(colorsU8, tw, th);
  }

  const gam = gamma > 0 ? gamma : 1;
  const offX = Math.floor(tw / 2); // center horizontally on X=0
  const columns: VoxelColumn[] = [];
  let voxelCount = 0;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const c = ty * tw + tx;
      if (alpha[c] < alphaThreshold) continue;
      if (bgMask && bgMask[c] === 0) continue; // dropped background
      const r = rgb[c * 3], gg = rgb[c * 3 + 1], b = rgb[c * 3 + 2];

      // Per-column height in voxels.
      let height: number;
      if (mode === 'heightmap') {
        let norm = luminance(r, gg, b) / 255;
        if (invert) norm = 1 - norm;
        if (gam !== 1) norm = Math.pow(Math.max(0, Math.min(1, norm)), gam);
        height = baseThickness + Math.round(norm * maxHeight);
      } else {
        height = depth;
      }
      if (height <= 0) continue; // e.g. heightmap, no base, fully dark

      // Resolve the voxel color for this pixel.
      let color: [number, number, number];
      if (colorMode === 'flat') {
        color = [clampByte(flatColor[0]), clampByte(flatColor[1]), clampByte(flatColor[2])];
      } else if (colorMode === 'grayscale') {
        const l = clampByte(luminance(r, gg, b));
        color = [l, l, l];
      } else if (snapLab && palette) {
        const lab = rgbToLab(clampByte(r), clampByte(gg), clampByte(b));
        color = palette[nearestPalette(lab[0], lab[1], lab[2], snapLab)];
      } else if (palette && assign) {
        color = palette[assign[c]];
      } else {
        color = [clampByte(r), clampByte(gg), clampByte(b)];
      }

      const x = tx - offX;
      const z = th - 1 - ty; // flip so image top is high Z; base sits at Z=0
      columns.push({ x, z, px: tx, py: ty, height, color });
      voxelCount += height;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (height > maxY) maxY = height;
    }
  }

  const dims = columns.length
    ? { x: maxX - minX + 1, y: maxY, z: maxZ - minZ + 1 }
    : { x: 0, y: 0, z: 0 };
  return { tw, th, columns, voxelCount, dims };
}

/** Convert image pixels into a centered, upright voxel model.
 *
 *  Mapping: image column → X (centered on 0), image row → Z (row 0 at the
 *  top, so the picture stands upright on the ground plane), extruded along
 *  +Y. In `billboard` mode every surviving pixel gets a flat `depth`-voxel
 *  column; in `heightmap` mode the per-pixel column height comes from the
 *  pixel's brightness (plus an optional solid backing). */
export function imageDataToVoxelGrid(image: ImageDataLike, options: ImageToVoxelOptions = {}): VoxelGrid {
  const { columns } = computeImageVoxelLayout(image, options);
  const grid = new VoxelGrid();
  for (const col of columns) {
    for (let y = 0; y < col.height; y++) grid.set(col.x, y, col.z, col.color);
  }
  return grid;
}

/** Extract `k` representative colors from an image using the same downsample +
 *  tonal pipeline the voxel import samples through, so a palette seeded here
 *  matches what the posterize option would produce (and what the import will
 *  snap to). Returns `[]` for a degenerate image. */
export function extractImagePalette(
  image: ImageDataLike,
  k: number,
  options: Pick<ImageToVoxelOptions, 'maxSize' | 'brightness' | 'contrast' | 'saturation'> = {},
): [number, number, number][] {
  const maxSize = Math.max(1, Math.min(Math.floor(options.maxSize ?? DEFAULTS.maxSize), HARD_MAX));
  const ds = downsampleImage(image, maxSize);
  if (!ds) return [];
  preprocessRgb(ds.rgb, ds.tw, ds.th, {
    brightness: options.brightness ?? 0,
    contrast: options.contrast ?? 0,
    saturation: options.saturation ?? 0,
    levelsLow: 0,
    levelsHigh: 255,
  });
  const kk = Math.max(1, Math.min(Math.floor(k), 64));
  const r = quantizeColors(ds.rgb, ds.count, kk, 'lab');
  const out: [number, number, number][] = [];
  for (let i = 0; i < r.k; i++) {
    out.push([clampByte(r.repRGB[i * 3]), clampByte(r.repRGB[i * 3 + 1]), clampByte(r.repRGB[i * 3 + 2])]);
  }
  return out;
}

/** Above this many builder calls, `'calls'` codegen falls back to the compact
 *  `voxels.decode(...)` blob so the editor stays responsive. */
export const MAX_BUILDER_CALLS = 6000;

function hexOf(rgb: number): string {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

/** One decomposed same-color box (inclusive corners). A single voxel has equal
 *  min/max corners. */
interface BoxOp { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; c: number }

/** A run of identical boxes (same color + size) stepping by a constant amount
 *  along one axis — collapsible into a single `for` loop. */
interface BoxRun { idxs: number[]; base: BoxOp; step: number; axis: 'x' | 'y' | 'z'; n: number }

/** Minimum repeated boxes before a `for` loop pays for itself (one loop line
 *  replaces N call lines, so 3 is the first net win). */
const LOOP_MIN_RUN = 3;

function axisPos(o: BoxOp, axis: 'x' | 'y' | 'z'): number {
  return axis === 'x' ? o.x0 : axis === 'y' ? o.y0 : o.z0;
}

/** Find runs of identical boxes spaced at a constant step along `axis`. Boxes
 *  are grouped by color + size + the two off-axis start coords, then each group
 *  is scanned for maximal constant-step arithmetic runs. */
function findAxisRuns(ops: BoxOp[], axis: 'x' | 'y' | 'z'): BoxRun[] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const size = `${o.x1 - o.x0},${o.y1 - o.y0},${o.z1 - o.z0}`;
    const fixed = axis === 'x' ? `${o.y0},${o.z0}` : axis === 'y' ? `${o.x0},${o.z0}` : `${o.x0},${o.y0}`;
    const k = `${o.c}|${size}|${fixed}`;
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(i);
  }
  const runs: BoxRun[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < LOOP_MIN_RUN) continue;
    idxs.sort((a, b) => axisPos(ops[a], axis) - axisPos(ops[b], axis));
    let s = 0;
    while (s + 1 < idxs.length) {
      const step = axisPos(ops[idxs[s + 1]], axis) - axisPos(ops[idxs[s]], axis);
      let e = s + 1;
      while (e + 1 < idxs.length && axisPos(ops[idxs[e + 1]], axis) - axisPos(ops[idxs[e]], axis) === step) e++;
      const runIdxs = idxs.slice(s, e + 1);
      if (step > 0 && runIdxs.length >= LOOP_MIN_RUN) {
        runs.push({ idxs: runIdxs, base: ops[runIdxs[0]], step, axis, n: runIdxs.length });
        s = e + 1;
      } else {
        s++;
      }
    }
  }
  return runs;
}

/** `base + i*d`, dropping the term when the step is 0 (a coordinate that
 *  doesn't move with the loop). */
function axisExpr(base: number, d: number): string {
  if (d === 0) return `${base}`;
  return d > 0 ? `${base} + i * ${d}` : `${base} - i * ${-d}`;
}

function singleLine(o: BoxOp): string {
  const hex = hexOf(o.c);
  return o.x0 === o.x1 && o.y0 === o.y1 && o.z0 === o.z1
    ? `v.set(${o.x0}, ${o.y0}, ${o.z0}, '${hex}');`
    : `v.fillBox([${o.x0}, ${o.y0}, ${o.z0}], [${o.x1}, ${o.y1}, ${o.z1}], '${hex}');`;
}

function loopLine(run: BoxRun): string {
  const o = run.base;
  const dx = run.axis === 'x' ? run.step : 0;
  const dy = run.axis === 'y' ? run.step : 0;
  const dz = run.axis === 'z' ? run.step : 0;
  const hex = hexOf(o.c);
  const min = `${axisExpr(o.x0, dx)}, ${axisExpr(o.y0, dy)}, ${axisExpr(o.z0, dz)}`;
  if (o.x0 === o.x1 && o.y0 === o.y1 && o.z0 === o.z1) {
    return `for (let i = 0; i < ${run.n}; i++) v.set(${min}, '${hex}');`;
  }
  const max = `${axisExpr(o.x1, dx)}, ${axisExpr(o.y1, dy)}, ${axisExpr(o.z1, dz)}`;
  return `for (let i = 0; i < ${run.n}; i++) v.fillBox([${min}], [${max}], '${hex}');`;
}

/** Emit builder-call lines for the decomposed boxes, collapsing axis-aligned
 *  arithmetic runs of identical boxes into `for` loops (so a repeated pattern —
 *  dots, stripes, a grid — costs one line instead of many). Greedily takes the
 *  longest non-overlapping runs first; every box is emitted exactly once. */
function emitBuilderLines(ops: BoxOp[]): string[] {
  const runs = [...findAxisRuns(ops, 'x'), ...findAxisRuns(ops, 'y'), ...findAxisRuns(ops, 'z')]
    .sort((a, b) => b.idxs.length - a.idxs.length);
  const runOf = new Map<number, BoxRun>();
  const consumed = new Set<number>();
  for (const run of runs) {
    if (run.idxs.some(i => consumed.has(i))) continue;
    for (const i of run.idxs) { consumed.add(i); runOf.set(i, run); }
  }
  const emitted = new Set<BoxRun>();
  const lines: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const run = runOf.get(i);
    if (run) {
      if (!emitted.has(run)) { emitted.add(run); lines.push(loopLine(run)); }
    } else {
      lines.push(singleLine(ops[i]));
    }
  }
  return lines;
}


/** Decompose a grid into a small set of same-color axis-aligned boxes via
 *  greedy growth (X, then Y, then Z), then emit `v.fillBox(...)` / `v.set(...)`
 *  builder calls — collapsing repeated, evenly-spaced identical boxes into `for`
 *  loops (see {@link emitBuilderLines}). Each cell is covered exactly once.
 *  Returns null for an empty grid. */
function gridToBuilderCalls(grid: VoxelGrid): string[] | null {
  const b = grid.bounds();
  if (!b) return null;
  const visited = new Set<number>();
  const key = (x: number, y: number, z: number) => VoxelGrid.keyOf(x, y, z);
  const ops: BoxOp[] = [];
  for (let x = b.min[0]; x <= b.max[0]; x++) {
    for (let y = b.min[1]; y <= b.max[1]; y++) {
      for (let z = b.min[2]; z <= b.max[2]; z++) {
        const c = grid.get(x, y, z);
        if (c === null || visited.has(key(x, y, z))) continue;
        // Grow a maximal same-color box of still-unvisited cells: +X first,
        // then extend the whole row in +Y, then the whole slab in +Z.
        let x1 = x;
        while (x1 + 1 <= b.max[0] && grid.get(x1 + 1, y, z) === c && !visited.has(key(x1 + 1, y, z))) x1++;
        let y1 = y;
        growY: while (y1 + 1 <= b.max[1]) {
          for (let xi = x; xi <= x1; xi++) {
            if (grid.get(xi, y1 + 1, z) !== c || visited.has(key(xi, y1 + 1, z))) break growY;
          }
          y1++;
        }
        let z1 = z;
        growZ: while (z1 + 1 <= b.max[2]) {
          for (let xi = x; xi <= x1; xi++)
            for (let yi = y; yi <= y1; yi++) {
              if (grid.get(xi, yi, z1 + 1) !== c || visited.has(key(xi, yi, z1 + 1))) break growZ;
            }
          z1++;
        }
        for (let xi = x; xi <= x1; xi++)
          for (let yi = y; yi <= y1; yi++)
            for (let zi = z; zi <= z1; zi++) visited.add(key(xi, yi, zi));
        ops.push({ x0: x, y0: y, z0: z, x1, y1, z1, c });
      }
    }
  }
  return emitBuilderLines(ops);
}

/** How many builder calls the `'calls'` codegen would emit for this grid (0 for
 *  an empty grid). Lets the import modal show, before committing, whether the
 *  editable-code style will be used or fall back to compact data at
 *  {@link MAX_BUILDER_CALLS}. */
export function countVoxelBuilderCalls(grid: VoxelGrid): number {
  const calls = gridToBuilderCalls(grid);
  return calls ? calls.length : 0;
}

/** Options for {@link generateVoxelImportCode}. */
export interface VoxelCodeOptions {
  /** `'decode'` (default) = compact blob; `'calls'` = editable builder calls. */
  style?: 'decode' | 'calls';
  /** Override the builder-call cap above which `'calls'` falls back to decode
   *  (mainly for tests). */
  maxCalls?: number;
}

/** Emit editor code that rebuilds a grid. The default `'decode'` style writes a
 *  compact `voxels.decode(...)` blob; `'calls'` writes human-readable
 *  `v.fillBox(...)` / `v.set(...)` builder calls (falling back to decode when
 *  the grid needs more than the cap, so the editor stays usable). Mirrors the
 *  imported-mesh codegen: human-readable header, one self-contained `return`. */
export function generateVoxelImportCode(grid: VoxelGrid, filename: string, opts: VoxelCodeOptions = {}): string {
  const date = new Date().toISOString().slice(0, 10);
  const b = grid.bounds();
  const dims = b
    ? `${b.max[0] - b.min[0] + 1}×${b.max[1] - b.min[1] + 1}×${b.max[2] - b.min[2] + 1}`
    : '0×0×0';
  // Preserve the grid's surfacing setting in the emitted code so a
  // smooth-surfaced model that's baked (e.g. via the voxel paint flow) keeps
  // its rounded edges after the next run, instead of silently reverting to
  // hard blocks. The default (blocks) needs no call.
  const surf = grid.surfacing();
  const surfaceCall = surf.mode === 'smooth'
    ? `\nv.smooth({ iterations: ${surf.iterations}, detail: ${surf.detail} });`
    : '';
  const header = `// Imported from ${filename} on ${date}\n`;

  if (opts.style === 'calls') {
    const calls = gridToBuilderCalls(grid);
    const cap = opts.maxCalls ?? MAX_BUILDER_CALLS;
    if (calls && calls.length > 0 && calls.length <= cap) {
      return `${header}// ${grid.size} voxels (${dims}) as editable builder calls. Tweak any line, add v.fillBox(...), etc.
const { voxels } = api;
const v = voxels();
${calls.join('\n')}${surfaceCall}
return v;
`;
    }
    // Too many distinct blocks to stay readable — fall back to the compact form
    // but say why, so the user knows to lower resolution / limit colors.
    const encoded = encodeGrid(grid);
    return `${header}// ${grid.size} voxels (${dims}). Too many distinct blocks for readable builder calls,
// so stored as compact data. Lower the resolution or limit the color palette to get editable code.
const { voxels } = api;
const v = voxels.decode(${JSON.stringify(encoded)});${surfaceCall}
return v;
`;
  }

  const encoded = encodeGrid(grid);
  return `${header}// ${grid.size} voxels (${dims}). Edit below — e.g. add v.fillBox(...) before returning.
const { voxels } = api;
const v = voxels.decode(${JSON.stringify(encoded)});${surfaceCall}
return v;
`;
}
