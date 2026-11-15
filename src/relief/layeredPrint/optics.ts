// Optical model for HueForge-style filament layering.
//
// A HueForge print is a heightmap printed in thin layers, with the filament
// swapped at chosen layers. Because thin plastic is translucent, the colour you
// see at a point depends on how thick each filament block is beneath the top
// surface there, so N filaments yield far more than N visible shades.
//
// Model (front-lit, matching HueForge's TD convention): composite bottom-up. The
// base block is opaque. Each later block of thickness t over the colour below
// covers it with opacity a = min(1, t / TD), so at TD the filament is fully
// opaque. Blending is in sRGB, like HueForge's preview, which keeps community
// TD values meaningful here.
//
// Pure math, no DOM.

import type { LayeredPrintFilament } from './filamentLibrary';

/** Layer geometry: first layer is usually thicker (0.16) than the rest (0.08). */
export interface LayerSpec {
  firstLayerHeight: number;
  layerHeight: number;
}

/** One filament block of a swap schedule: `filament` prints from layer
 *  `startLayer` (0-based) up to the next block's start. Block 0 starts at 0. */
export interface ScheduleBlock {
  filament: LayeredPrintFilament;
  startLayer: number;
}

/** Z of the TOP of 0-based layer `i`. */
export function layerTop(i: number, spec: LayerSpec): number {
  return spec.firstLayerHeight + i * spec.layerHeight;
}

/** Z of the BOTTOM of 0-based layer `i`. */
export function layerBottom(i: number, spec: LayerSpec): number {
  return i <= 0 ? 0 : spec.firstLayerHeight + (i - 1) * spec.layerHeight;
}

/** Number of layers that fit under `maxHeightMm` (at least 1). */
export function layerCountFor(maxHeightMm: number, spec: LayerSpec): number {
  return Math.max(1, Math.floor((maxHeightMm - spec.firstLayerHeight) / spec.layerHeight + 1e-6) + 1);
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Composite colour seen at the top of every layer for a schedule: an
 *  interleaved sRGB (0..1) Float32Array of `numLayers * 3`. Entry i is what a
 *  pixel whose surface is the top of layer i looks like. Blocks must be sorted
 *  by `startLayer`, with block 0 at layer 0. */
export function computeLadder(blocks: readonly ScheduleBlock[], numLayers: number, spec: LayerSpec): Float32Array {
  const out = new Float32Array(numLayers * 3);
  if (blocks.length === 0) return out;
  const cols = blocks.map((b) => hexToRgb01(b.filament.hex));
  for (let i = 0; i < numLayers; i++) {
    let [r, g, b] = cols[0];
    for (let k = 1; k < blocks.length; k++) {
      const s = blocks[k].startLayer;
      if (s > i) break;
      const end = k + 1 < blocks.length ? Math.min(i, blocks[k + 1].startLayer - 1) : i;
      const t = layerTop(end, spec) - layerBottom(s, spec);
      if (t <= 0) continue;
      const a = Math.min(1, t / Math.max(1e-4, blocks[k].filament.td));
      const c = cols[k];
      r += (c[0] - r) * a;
      g += (c[1] - g) * a;
      b += (c[2] - b) * a;
    }
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

// ── CIE Lab (D65) ────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

/** sRGB (0..1) → CIE Lab (L 0..100). */
export function rgb01ToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = labF(X), fy = labF(Y), fz = labF(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Ladder (sRGB interleaved) → Lab interleaved. */
export function ladderToLab(ladder: Float32Array): Float32Array {
  const n = ladder.length / 3;
  const out = new Float32Array(ladder.length);
  for (let i = 0; i < n; i++) {
    const [L, a, b] = rgb01ToLab(ladder[i * 3], ladder[i * 3 + 1], ladder[i * 3 + 2]);
    out[i * 3] = L;
    out[i * 3 + 1] = a;
    out[i * 3 + 2] = b;
  }
  return out;
}
