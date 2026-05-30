// Multi-view silhouette carving (visual hull) — prototype reconstruction.
//
// Given N silhouette masks of a subject taken at KNOWN camera angles, this
// recovers an approximate 3D shape by space-carving: a voxel survives only if
// it projects *inside* the silhouette in EVERY view. The intersection of all
// back-projected silhouette cones is the "visual hull" — the tightest shape
// consistent with all the outlines.
//
// Why this approach (and not dense photometric multi-view stereo): the views
// in our workflow are *synthesized* by a frontier image model (e.g. a Gemini
// turntable from one photo). Those views are NOT photometrically consistent —
// the texture the model invents at 90° need not match what it invents at 180°.
// Silhouette carving is robust to that: it only needs the outline to be
// roughly right, a far weaker requirement that current image models can meet.
//
// Known limitation: a visual hull can never recover concavities that are not
// visible on ANY silhouette (eye sockets, the dish under the chin). More views
// tighten the hull but cannot add that information — for concavities you need
// depth/landmark data, not more outlines.
//
// Camera convention MUST match the renderer's `buildViewCamera`
// (src/renderer/multiview.ts): Z-up, orthographic, camera looks at the origin
// with up = (0,0,1).
//   azimuth   0 = front (+Y), 90 = right (+X), 180 = back (-Y), 270 = left (-X)
//   elevation 0 = horizon, 90 = top-down (avoid exactly 90 — gimbal-degenerate)
//
// Pure logic: no DOM, no WASM, no engine imports — unit-testable in the vitest
// tier. The browser glue (decoding image URLs to pixels) lives in main.ts.

import { VoxelGrid, normalizeColor, type ColorInput } from '../geometry/voxel/grid';

export type Vec3 = [number, number, number];

/** One silhouette, with the camera angle it was seen from. */
export interface SilhouetteView {
  width: number;
  height: number;
  /** Row-major occupancy, length width*height. 1 = subject, 0 = background. */
  mask: Uint8Array;
  /** Degrees. Renderer convention (see file header). */
  azimuth: number;
  /** Degrees. 0 = horizon, 90 = top-down. */
  elevation: number;
  /** Optional RGBA pixels (length width*height*4) used by `colorFromViews`. */
  rgba?: Uint8Array | Uint8ClampedArray;
}

export interface CarveOptions {
  /** Grid cells per axis before trimming to the occupied bounds. Default 80. */
  resolution?: number;
  /** Fraction of the frame that the carve's normalized [-1,1] range spans —
   *  i.e. roughly how much of each image the subject fills. 1 = subject touches
   *  the frame edges; 0.8 = ~20% margin. Default 1. */
  frameFill?: number;
  /** Flat colour for every voxel when `colorFromViews` is off / unavailable. */
  color?: ColorInput;
  /** Sample each surface voxel's colour from the view that most directly faces
   *  it (needs `rgba` on the views). Gives a cheap multi-view "texture". */
  colorFromViews?: boolean;
}

/** Camera screen axes for an (azimuth, elevation), matching `buildViewCamera`.
 *  `camDir` points from the origin toward the camera; `xAxis`/`yAxis` are the
 *  orthographic screen right / up directions. */
export function viewAxes(azimuthDeg: number, elevationDeg: number): {
  camDir: Vec3; xAxis: Vec3; yAxis: Vec3;
} {
  const a = (azimuthDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
  // Derived from three.js lookAt(origin) with up=(0,0,1):
  //   zAxis (toward camera) = (ce*sa, ce*ca, se)
  //   xAxis = normalize(up × zAxis) = (-ca, sa, 0)
  //   yAxis = zAxis × xAxis        = (-se*sa, -se*ca, ce)
  return {
    camDir: [ce * sa, ce * ca, se],
    xAxis: [-ca, sa, 0],
    yAxis: [-se * sa, -se * ca, ce],
  };
}

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Count foreground pixels — used to reject all-background masks. */
export function silhouetteCoverage(view: SilhouetteView): number {
  let n = 0;
  for (let i = 0; i < view.mask.length; i++) if (view.mask[i]) n++;
  return n;
}

interface PreparedView {
  xAxis: Vec3; yAxis: Vec3; camDir: Vec3;
  width: number; height: number;
  mask: Uint8Array;
  rgba?: Uint8Array | Uint8ClampedArray;
  // Pixel mapping: pix = c/2 + ndc * (c/2 * frameFill)
  halfW: number; halfH: number; spanW: number; spanH: number;
}

/** Project a point (in grid-coordinate units, origin at grid centre) into a
 *  prepared view; returns integer pixel coords, or null if off-frame. */
function project(p: Vec3, v: PreparedView, invHalf: number): { px: number; py: number } | null {
  const ndcx = dot(p, v.xAxis) * invHalf;
  const ndcy = dot(p, v.yAxis) * invHalf;
  const px = (v.halfW + ndcx * v.spanW) | 0;
  const py = (v.halfH - ndcy * v.spanH) | 0;
  if (px < 0 || px >= v.width || py < 0 || py >= v.height) return null;
  return { px, py };
}

/**
 * Carve the visual hull of `views` into a `VoxelGrid`. Throws if no views are
 * given or any mask is empty (an empty silhouette would carve everything away).
 */
export function carveVisualHull(views: SilhouetteView[], opts: CarveOptions = {}): VoxelGrid {
  if (views.length === 0) throw new Error('carveVisualHull: need at least one view');
  const resolution = Math.max(8, Math.min(256, Math.round(opts.resolution ?? 80)));
  const frameFill = opts.frameFill ?? 1;
  const flatColor = normalizeColor(opts.color ?? [200, 180, 170], 'color');
  const colorFromViews = opts.colorFromViews === true;

  const prepared: PreparedView[] = views.map((view, i) => {
    if (silhouetteCoverage(view) === 0) {
      throw new Error(`carveVisualHull: view ${i} (az ${view.azimuth}, el ${view.elevation}) has an empty silhouette`);
    }
    const { xAxis, yAxis, camDir } = viewAxes(view.azimuth, view.elevation);
    return {
      xAxis, yAxis, camDir,
      width: view.width, height: view.height,
      mask: view.mask, rgba: view.rgba,
      halfW: view.width / 2, halfH: view.height / 2,
      spanW: (view.width / 2) * frameFill, spanH: (view.height / 2) * frameFill,
    };
  });

  const grid = new VoxelGrid();
  const half = resolution / 2;
  const invHalf = 1 / half;
  const lo = -Math.floor(half);
  const hi = Math.ceil(half) - 1;

  for (let gx = lo; gx <= hi; gx++) {
    for (let gy = lo; gy <= hi; gy++) {
      for (let gz = lo; gz <= hi; gz++) {
        const p: Vec3 = [gx + 0.5, gy + 0.5, gz + 0.5];
        let inside = true;
        for (let i = 0; i < prepared.length; i++) {
          const hit = project(p, prepared[i], invHalf);
          if (!hit || prepared[i].mask[hit.py * prepared[i].width + hit.px] === 0) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;
        grid.set(gx, gy, gz, colorFromViews ? voxelColor(p, prepared, invHalf, flatColor) : flatColor);
      }
    }
  }
  return grid;
}

/** Colour a surface voxel from the view whose camera most directly faces it. */
function voxelColor(p: Vec3, views: PreparedView[], invHalf: number, fallback: number): number {
  const len = Math.hypot(p[0], p[1], p[2]) || 1;
  const dir: Vec3 = [p[0] / len, p[1] / len, p[2] / len];
  let best = -Infinity;
  let chosen: PreparedView | null = null;
  for (const v of views) {
    if (!v.rgba) continue;
    const facing = dot(dir, v.camDir);
    if (facing > best) { best = facing; chosen = v; }
  }
  if (!chosen) return fallback;
  const hit = project(p, chosen, invHalf);
  if (!hit) return fallback;
  const o = (hit.py * chosen.width + hit.px) * 4;
  const r = chosen.rgba![o], g = chosen.rgba![o + 1], b = chosen.rgba![o + 2];
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export interface MaskOptions {
  /** When the image has a real alpha channel, the cutoff for "subject". 0–255. */
  alphaThreshold?: number;
  /** Background colour for chroma-keying opaque images. `null` = auto-detect
   *  from the image corners. */
  backgroundColor?: Vec3 | null;
  /** RGB distance (0–441) beyond which a pixel counts as subject. Default 64. */
  bgTolerance?: number;
}

/** Average the four corner pixels — a cheap background-colour estimate. */
function autoDetectBackground(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Vec3 {
  const corners = [0, (w - 1), (h - 1) * w, (h - 1) * w + (w - 1)];
  let r = 0, g = 0, b = 0;
  for (const idx of corners) {
    const o = idx * 4;
    r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2];
  }
  return [r / 4, g / 4, b / 4];
}

/**
 * Extract a binary silhouette mask from RGBA pixels. Uses the alpha channel
 * when the image actually carries transparency; otherwise chroma-keys against
 * the background colour (supplied or auto-detected from the corners).
 */
export function imageToMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: MaskOptions = {},
): Uint8Array {
  const n = width * height;
  const mask = new Uint8Array(n);
  const alphaThreshold = opts.alphaThreshold ?? 128;

  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 250) { hasAlpha = true; break; }
  }

  if (hasAlpha) {
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    return mask;
  }

  const bg = opts.backgroundColor ?? autoDetectBackground(rgba, width, height);
  const tol = opts.bgTolerance ?? 64;
  const tol2 = tol * tol;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = rgba[o] - bg[0], dg = rgba[o + 1] - bg[1], db = rgba[o + 2] - bg[2];
    mask[i] = dr * dr + dg * dg + db * db > tol2 ? 1 : 0;
  }
  return mask;
}
