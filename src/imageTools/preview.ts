// Live preview for the Image tools panel (#1256): a small 2D raster of what a
// tool will make from an image, shown before its wizard opens. Each preview is
// the tool's OWN sampling at a capped resolution, not a separate model of it:
//   - relief tools → `sampleImageToGrid` (the relief wizard's preview source):
//     cluster colours for tiles, a brightness → height ramp for lithophanes,
//     cut-away background as a checkerboard;
//   - voxel → `computeImageVoxelLayout` (the voxel modal's preview source);
//   - layered print → a tonal (greyscale) hint; its filaments and swap heights
//     are a solve, which stays in its dialog.
// Pure — no DOM. The panel decodes the image and draws the returned pixels.

import type { ImageToolId } from './descriptor';
import { imageToolInfo, reliefOptionsForOp } from './descriptor';
import { sampleImageToGrid, detectBackgroundMask } from '../relief/imageToRelief';
import { computeImageVoxelLayout, type ImageToVoxelOptions } from '../import/imageToVoxel';
import type { PixelImage } from './prep';

export interface ImageToolPreview {
  width: number;
  height: number;
  /** RGBA, row 0 at the top. */
  rgba: Uint8ClampedArray;
  /** One-line description ("Preview · 80×60 · 6 colours"). */
  caption: string;
}

/** Checkerboard shade for a cut-away / transparent cell (reads as "empty"). */
function checker(x: number, y: number): number {
  return ((x >> 1) + (y >> 1)) & 1 ? 64 : 36;
}

function fillChecker(out: Uint8ClampedArray, i: number, x: number, y: number): void {
  const v = checker(x, y);
  out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v + 4; out[i * 4 + 3] = 255;
}

/** Box-downsample to fit `maxPx` on the long side, compositing over white. */
function downsampleOverWhite(img: PixelImage, maxPx: number): { w: number; h: number; rgb: Uint8ClampedArray } {
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * img.height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * img.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * img.width + sx) * 4;
          const a = img.data[o + 3] / 255;
          r += img.data[o] * a + 255 * (1 - a);
          g += img.data[o + 1] * a + 255 * (1 - a);
          b += img.data[o + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const c = (y * w + x) * 3;
      rgb[c] = r / n; rgb[c + 1] = g / n; rgb[c + 2] = b / n;
    }
  }
  return { w, h, rgb };
}

function reliefPreview(tool: ImageToolId, img: PixelImage, params: Record<string, unknown>, maxPx: number): ImageToolPreview {
  const opts = reliefOptionsForOp(tool, params);
  opts.common = { ...opts.common, resolution: Math.max(8, Math.min(opts.common.resolution, maxPx)) };
  const grid = sampleImageToGrid(img as unknown as ImageData, opts);
  const w = grid.width, h = grid.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const maxH = opts.common.maxHeight > 0 ? opts.common.maxHeight : 1;
  // Which cells are cut: the detected background (remove-background), or the
  // silhouette tile's outline.
  let cut: Uint8Array | null = grid.bgMask ?? null;
  if (!cut && opts.mode === 'quantized' && opts.quantized.output === 'silhouette' && grid.colors) {
    cut = detectBackgroundMask(grid.colors, w, h);
  }
  // The grid is bottom-row-first (world +Y up); the preview draws top-down.
  for (let py = 0; py < h; py++) {
    const sy = h - 1 - py;
    for (let px = 0; px < w; px++) {
      const s = sy * w + px;
      const i = py * w + px;
      if (cut && cut[s] === 0) { fillChecker(out, i, px, py); continue; }
      if (opts.mode === 'quantized' && grid.colors) {
        out[i * 4] = grid.colors[s * 3];
        out[i * 4 + 1] = grid.colors[s * 3 + 1];
        out[i * 4 + 2] = grid.colors[s * 3 + 2];
      } else {
        const g = Math.max(0, Math.min(255, Math.round((grid.heights[s] / maxH) * 255)));
        out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g;
      }
      out[i * 4 + 3] = 255;
    }
  }
  const detail = opts.mode === 'quantized'
    ? `${opts.quantized.clusters} colours${opts.quantized.output === 'relief' ? ', stepped' : ''}`
    : `${opts.luminance.levels} height levels (light = tall)`;
  return { width: w, height: h, rgba: out, caption: `Preview · ${w}×${h} · ${detail}` };
}

function voxelPreview(img: PixelImage, params: Record<string, unknown>, maxPx: number): ImageToolPreview {
  const p = params as ImageToVoxelOptions;
  const layout = computeImageVoxelLayout(img, { ...p, maxSize: Math.max(4, Math.min(p.maxSize ?? 64, maxPx)) });
  const w = layout.tw, h = layout.th;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fillChecker(out, y * w + x, x, y);
  for (const c of layout.columns) {
    const i = c.py * w + c.px;
    out[i * 4] = c.color[0]; out[i * 4 + 1] = c.color[1]; out[i * 4 + 2] = c.color[2]; out[i * 4 + 3] = 255;
  }
  const d = layout.dims;
  return { width: w, height: h, rgba: out, caption: `Preview · ${layout.voxelCount.toLocaleString()} voxels · ${d.x}×${d.y}×${d.z}` };
}

function layeredPreview(img: PixelImage, params: Record<string, unknown>, maxPx: number): ImageToolPreview {
  const { w, h, rgb } = downsampleOverWhite(img, maxPx);
  // A tonal hint: brightness bucketed into a few shades, the way a few
  // stacked filaments read. The real colours come from the solve.
  const n = typeof params.colors === 'number' && params.colors >= 2 ? Math.min(16, Math.round(params.colors)) : 6;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255;
    const q = Math.round(Math.round(l * (n - 1)) / (n - 1) * 255);
    out[i * 4] = q; out[i * 4 + 1] = q; out[i * 4 + 2] = q; out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, rgba: out, caption: `Tonal hint · ${w}×${h} · filaments and swaps are solved in the dialog` };
}

/** What `tool` makes from `img` with `params` (its stored params, or {} for
 *  defaults), at most `maxPx` on the long side. */
export function renderImageToolPreview(tool: ImageToolId, img: PixelImage, params: Record<string, unknown>, maxPx: number): ImageToolPreview {
  const engine = imageToolInfo(tool).engine;
  if (engine === 'relief') return reliefPreview(tool, img, params, maxPx);
  if (engine === 'voxel') return voxelPreview(img, params, maxPx);
  return layeredPreview(img, params, maxPx);
}
