// Shared image prep for the image tools (#1256): crop, tone (brightness /
// contrast / saturation / black + white points) and optional background
// removal, applied ONCE to an attached image to make a derived "(prepped)"
// attachment. Every tool then reads plain pixels — no tool needs to know about
// prep, and the original attachment is kept.
//
// Reuses the relief pipeline's own pieces rather than a new algorithm:
// `preprocessRgb` (the relief wizard's tone controls) and the background
// detectors `detectBackgroundMask` / `bgMaskFromColor` (shared with the voxel
// import). Pure — no DOM; the caller decodes and encodes the image.

import type { CropRect } from '../relief/types';
import { preprocessRgb, detectBackgroundMask, bgMaskFromColor } from '../relief/imageToRelief';

export interface ImagePrepOptions {
  /** Normalised 0..1 crop over the source (left/top/right/bottom). */
  crop?: CropRect;
  /** −1..+1. 0 = unchanged. */
  brightness?: number;
  /** −1..+1. 0 = unchanged. */
  contrast?: number;
  /** −1..+1. 0 = unchanged, −1 = greyscale. */
  saturation?: number;
  /** Black point 0..254. */
  levelsLow?: number;
  /** White point 1..255. */
  levelsHigh?: number;
  /** Make the background transparent (dominant border colour, or `backgroundColor`). */
  removeBackground?: boolean;
  /** Explicit background colour to remove (RGB bytes). */
  backgroundColor?: [number, number, number];
}

const IMAGE_PREP_KEYS = ['crop', 'brightness', 'contrast', 'saturation', 'levelsLow', 'levelsHigh', 'removeBackground', 'backgroundColor'] as const;

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PrepResult extends PixelImage {
  /** removeBackground was asked for and a background was found. */
  backgroundRemoved: boolean;
}

/** Background pixels are written as white with alpha 1/255 rather than 0: a
 *  canvas round-trip drops the colour of fully transparent pixels (they read
 *  back black), so a tool that ignores alpha (a flat relief tile) would see a
 *  black backdrop. At alpha 1 they read back white, and every alpha-aware
 *  consumer still treats them as transparent (voxel cutoff 128, relief's alpha
 *  mask < 128, the layered-print solver composites over white). */
export const PREP_BACKGROUND_ALPHA = 1;

function isFullCrop(c: CropRect | undefined): boolean {
  return !c || (c.left <= 0.001 && c.top <= 0.001 && c.right >= 0.999 && c.bottom >= 0.999);
}

function hasTone(o: ImagePrepOptions): boolean {
  return (o.brightness ?? 0) !== 0 || (o.contrast ?? 0) !== 0 || (o.saturation ?? 0) !== 0
    || (o.levelsLow ?? 0) !== 0 || (o.levelsHigh ?? 255) !== 255;
}

/** True when `o` would leave the image unchanged. */
export function isNoopPrep(o: ImagePrepOptions): boolean {
  return isFullCrop(o.crop) && !hasTone(o) && !o.removeBackground;
}

/** Validate an options object from an API / AI caller. Throws a plain Error
 *  naming the bad field; returns a clean copy (only known keys). */
export function parseImagePrepOptions(raw: Record<string, unknown>, where = 'prepImage'): ImagePrepOptions {
  const out: ImagePrepOptions = {};
  for (const k of Object.keys(raw)) {
    if (!(IMAGE_PREP_KEYS as readonly string[]).includes(k)) throw new Error(`${where}: unknown option "${k}" (expected ${IMAGE_PREP_KEYS.join(', ')})`);
  }
  const num = (k: 'brightness' | 'contrast' | 'saturation' | 'levelsLow' | 'levelsHigh', lo: number, hi: number) => {
    const v = raw[k];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${where}: ${k} must be a number in ${lo}..${hi}`);
    out[k] = v;
  };
  num('brightness', -1, 1);
  num('contrast', -1, 1);
  num('saturation', -1, 1);
  num('levelsLow', 0, 254);
  num('levelsHigh', 1, 255);
  if (out.levelsLow !== undefined && out.levelsHigh !== undefined && out.levelsHigh <= out.levelsLow) {
    throw new Error(`${where}: levelsHigh must be above levelsLow`);
  }
  if (raw.removeBackground !== undefined) {
    if (typeof raw.removeBackground !== 'boolean') throw new Error(`${where}: removeBackground must be a boolean`);
    out.removeBackground = raw.removeBackground;
  }
  if (raw.backgroundColor !== undefined) {
    const c = raw.backgroundColor;
    if (!Array.isArray(c) || c.length !== 3 || c.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 255)) {
      throw new Error(`${where}: backgroundColor must be [r, g, b] bytes (0..255)`);
    }
    out.backgroundColor = [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
  }
  if (raw.crop !== undefined) {
    const c = raw.crop as Record<string, unknown>;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${where}: crop must be {left, top, right, bottom} (0..1)`);
    for (const k of Object.keys(c)) {
      if (!['left', 'top', 'right', 'bottom'].includes(k)) throw new Error(`${where}: crop has unknown key "${k}"`);
    }
    const v = (k: string, d: number) => {
      const x = c[k] === undefined ? d : c[k];
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) throw new Error(`${where}: crop.${k} must be a number in 0..1`);
      return x;
    };
    const crop = { left: v('left', 0), top: v('top', 0), right: v('right', 1), bottom: v('bottom', 1) };
    if (crop.right - crop.left < 0.01 || crop.bottom - crop.top < 0.01) throw new Error(`${where}: crop must keep some of the image (right > left, bottom > top)`);
    out.crop = crop;
  }
  return out;
}

/** Apply prep to RGBA pixels. Returns a new image (the input is not touched). */
export function prepImagePixels(src: PixelImage, o: ImagePrepOptions): PrepResult {
  const sw = src.width, sh = src.height;
  // Crop rectangle in pixels (at least 1×1).
  let x0 = 0, y0 = 0, x1 = sw, y1 = sh;
  if (!isFullCrop(o.crop)) {
    const c = o.crop!;
    x0 = Math.max(0, Math.min(sw - 1, Math.floor(Math.min(c.left, c.right) * sw)));
    y0 = Math.max(0, Math.min(sh - 1, Math.floor(Math.min(c.top, c.bottom) * sh)));
    x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil(Math.max(c.left, c.right) * sw)));
    y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil(Math.max(c.top, c.bottom) * sh)));
  }
  const w = x1 - x0, h = y1 - y0, n = w * h;
  const rgb = new Float32Array(n * 3);
  const alpha = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    let s = ((y + y0) * sw + x0) * 4;
    for (let x = 0; x < w; x++, s += 4) {
      const i = y * w + x;
      rgb[i * 3] = src.data[s];
      rgb[i * 3 + 1] = src.data[s + 1];
      rgb[i * 3 + 2] = src.data[s + 2];
      alpha[i] = src.data[s + 3];
    }
  }
  if (hasTone(o)) {
    preprocessRgb(rgb, w, h, {
      brightness: o.brightness ?? 0,
      contrast: o.contrast ?? 0,
      saturation: o.saturation ?? 0,
      levelsLow: o.levelsLow ?? 0,
      levelsHigh: o.levelsHigh ?? 255,
    });
  }
  const bytes = new Uint8Array(n * 3);
  for (let i = 0; i < n * 3; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(rgb[i])));

  let mask: Uint8Array | null = null;
  if (o.removeBackground) {
    if (o.backgroundColor) {
      mask = bgMaskFromColor(bytes, w, h, o.backgroundColor);
    } else {
      // The detector matches the dominant border colour EXACTLY, which a
      // photo's noisy backdrop never is. So: find the dominant border colour
      // on a 5-bit-per-channel copy, then remove everything near that
      // colour's mean with the tolerant colour matcher.
      const snapped = new Uint8Array(n * 3);
      for (let i = 0; i < n * 3; i++) snapped[i] = bytes[i] & 0xf8;
      const coarse = detectBackgroundMask(snapped, w, h);
      let r = 0, g = 0, b = 0, k = 0;
      for (let i = 0; i < n; i++) {
        if (coarse[i] !== 0) continue;
        r += bytes[i * 3]; g += bytes[i * 3 + 1]; b += bytes[i * 3 + 2]; k++;
      }
      if (k > 0) mask = bgMaskFromColor(bytes, w, h, [Math.round(r / k), Math.round(g / k), Math.round(b / k)]);
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  let removed = 0;
  for (let i = 0; i < n; i++) {
    const d = i * 4;
    if (mask && mask[i] === 0) {
      out[d] = 255; out[d + 1] = 255; out[d + 2] = 255; out[d + 3] = PREP_BACKGROUND_ALPHA;
      removed++;
      continue;
    }
    out[d] = bytes[i * 3];
    out[d + 1] = bytes[i * 3 + 1];
    out[d + 2] = bytes[i * 3 + 2];
    out[d + 3] = alpha[i];
  }
  return { width: w, height: h, data: out, backgroundRemoved: removed > 0 };
}

/** Short human-readable summary, e.g. "crop 10–90% × 0–100%, contrast +0.2,
 *  background removed". Stored as the derived attachment's description. */
export function describeImagePrep(o: ImagePrepOptions): string {
  const parts: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const sgn = (v: number) => (v > 0 ? `+${v}` : String(v));
  if (!isFullCrop(o.crop)) parts.push(`crop ${pct(o.crop!.left)}–${pct(o.crop!.right)} × ${pct(o.crop!.top)}–${pct(o.crop!.bottom)}`);
  if (o.brightness) parts.push(`brightness ${sgn(o.brightness)}`);
  if (o.contrast) parts.push(`contrast ${sgn(o.contrast)}`);
  if (o.saturation) parts.push(`saturation ${sgn(o.saturation)}`);
  if ((o.levelsLow ?? 0) !== 0 || (o.levelsHigh ?? 255) !== 255) parts.push(`levels ${o.levelsLow ?? 0}–${o.levelsHigh ?? 255}`);
  if (o.removeBackground) parts.push(o.backgroundColor ? `background rgb(${o.backgroundColor.join(', ')}) removed` : 'background removed');
  return parts.length ? parts.join(', ') : 'no changes';
}
