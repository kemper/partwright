// MagicaVoxel .vox exporter — serialize a VoxelGrid to the RIFF-style binary
// format MagicaVoxel / Goxel read. This is the inverse of the importer in
// src/import/parsers/vox.ts; the two round-trip (export → import reproduces the
// occupancy pattern + colors).
//
// Format (all little-endian):
//
//   "VOX " + version (uint32, 150)
//   MAIN { contentSize = 0, childrenSize } wrapping, in order:
//     SIZE { x, y, z : uint32 }
//     XYZI { count : uint32, count × (x, y, z, colorIndex : uint8) }
//     RGBA { 256 × (r, g, b, a : uint8) }   — file slot k holds palette index k+1
//
// XYZI coordinates are single bytes (0–255), so one model spans at most 256³,
// and color indices are 1-based into a 255-color palette (slot 0 is reserved /
// transparent). We translate the grid's min corner to the origin, build a
// palette from its distinct colors (reducing to the 255 most-frequent, with
// nearest-color snapping, when a grid has more), and emit a single model.
//
// `encodeVox` is pure logic (no DOM, no WASM) so it's unit-tested in the vitest
// tier and round-tripped against `parseVox`; `buildVOX` / `exportVOX` wrap it
// with the Blob + download plumbing.
//
// Reference: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt

import { VoxelGrid } from '../geometry/voxel/grid';
import { downloadBlob, getExportFilename } from './download';
import type { BuiltExport } from './gltf';

/** MagicaVoxel per-axis voxel limit — XYZI coordinates are single bytes. */
const MAX_DIM = 256;
/** Usable palette size — indices 1…255 (index 0 is reserved / transparent). */
const MAX_COLORS = 255;

/** Index of the palette entry nearest `rgb` (squared-Euclidean in RGB). */
function nearestIndex(rgb: number, palette: number[]): number {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const pr = (palette[i] >> 16) & 0xff, pg = (palette[i] >> 8) & 0xff, pb = palette[i] & 0xff;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Wrap `content` in a leaf chunk (id + contentSize + childrenSize=0). */
function leafChunk(id: string, content: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + content.length);
  out[0] = id.charCodeAt(0); out[1] = id.charCodeAt(1); out[2] = id.charCodeAt(2); out[3] = id.charCodeAt(3);
  new DataView(out.buffer).setUint32(4, content.length, true); // contentSize; childrenSize stays 0
  out.set(content, 12);
  return out;
}

/** Serialize a grid to MagicaVoxel `.vox` bytes. Throws a clear, actionable
 *  error on an empty grid or one whose bounding box exceeds 256 voxels on any
 *  axis (the format's single-model limit). */
export function encodeVox(grid: VoxelGrid): Uint8Array {
  const b = grid.bounds();
  if (!b) {
    throw new Error('Cannot export an empty voxel grid to .vox — set some voxels first.');
  }
  const sx = b.max[0] - b.min[0] + 1;
  const sy = b.max[1] - b.min[1] + 1;
  const sz = b.max[2] - b.min[2] + 1;
  if (sx > MAX_DIM || sy > MAX_DIM || sz > MAX_DIM) {
    throw new Error(
      `This model is ${sx}×${sy}×${sz} voxels; the .vox format is limited to ${MAX_DIM} per axis. ` +
      `Shrink the model's extent, or export GLB / 3MF for large meshes.`,
    );
  }

  // ── Palette: map each distinct grid color to a 1-based index. With more than
  //    255 distinct colors, keep the 255 most-frequent as representatives and
  //    snap the rest to the nearest kept color so no voxel is dropped.
  const freq = new Map<number, number>();
  grid.forEach((_x, _y, _z, c) => freq.set(c, (freq.get(c) ?? 0) + 1));
  const distinct = [...freq.keys()];

  let palette: number[]; // palette[k-1] = 0xRRGGBB for 1-based index k
  const colorToIndex = new Map<number, number>();
  if (distinct.length <= MAX_COLORS) {
    palette = distinct;
    distinct.forEach((c, i) => colorToIndex.set(c, i + 1));
  } else {
    palette = [...distinct].sort((a, c) => freq.get(c)! - freq.get(a)!).slice(0, MAX_COLORS);
    palette.forEach((c, i) => colorToIndex.set(c, i + 1));
    for (const c of distinct) {
      if (!colorToIndex.has(c)) colorToIndex.set(c, nearestIndex(c, palette) + 1);
    }
  }

  // ── XYZI: count + (x, y, z, index) per voxel, corner-aligned to the origin.
  const count = grid.size;
  const xyzi = new Uint8Array(4 + count * 4);
  new DataView(xyzi.buffer).setUint32(0, count, true);
  let off = 4;
  grid.forEach((x, y, z, c) => {
    xyzi[off++] = x - b.min[0];
    xyzi[off++] = y - b.min[1];
    xyzi[off++] = z - b.min[2];
    xyzi[off++] = colorToIndex.get(c)!;
  });

  // ── SIZE.
  const size = new Uint8Array(12);
  const sdv = new DataView(size.buffer);
  sdv.setUint32(0, sx, true); sdv.setUint32(4, sy, true); sdv.setUint32(8, sz, true);

  // ── RGBA: 256 entries; file slot k stores palette index k+1, alpha opaque.
  const rgba = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    const rgb = palette[i] ?? 0;
    rgba[i * 4] = (rgb >> 16) & 0xff;
    rgba[i * 4 + 1] = (rgb >> 8) & 0xff;
    rgba[i * 4 + 2] = rgb & 0xff;
    rgba[i * 4 + 3] = 0xff;
  }

  const sizeChunk = leafChunk('SIZE', size);
  const xyziChunk = leafChunk('XYZI', xyzi);
  const rgbaChunk = leafChunk('RGBA', rgba);
  const childrenLen = sizeChunk.length + xyziChunk.length + rgbaChunk.length;

  // ── File header + MAIN wrapper (children follow MAIN's 12-byte header).
  const header = new Uint8Array(8);
  header[0] = 0x56; header[1] = 0x4f; header[2] = 0x58; header[3] = 0x20; // "VOX "
  new DataView(header.buffer).setUint32(4, 150, true);

  const main = new Uint8Array(12);
  main[0] = 0x4d; main[1] = 0x41; main[2] = 0x49; main[3] = 0x4e; // "MAIN"
  const mdv = new DataView(main.buffer);
  mdv.setUint32(4, 0, true);            // contentSize (data lives in children)
  mdv.setUint32(8, childrenLen, true);  // childrenSize

  const out = new Uint8Array(header.length + main.length + childrenLen);
  let p = 0;
  out.set(header, p); p += header.length;
  out.set(main, p); p += main.length;
  out.set(sizeChunk, p); p += sizeChunk.length;
  out.set(xyziChunk, p); p += xyziChunk.length;
  out.set(rgbaChunk, p);
  return out;
}

/** Build the `.vox` blob for a grid without triggering a download. */
export function buildVOX(grid: VoxelGrid, customName?: string): BuiltExport {
  const bytes = encodeVox(grid);
  const mimeType = 'application/octet-stream';
  const blob = new Blob([bytes], { type: mimeType });
  return { blob, filename: getExportFilename('vox', customName), mimeType };
}

/** Build and download the current grid as a MagicaVoxel `.vox` file. */
export function exportVOX(grid: VoxelGrid, customName?: string): string {
  const built = buildVOX(grid, customName);
  downloadBlob(built.blob, built.filename, 'VOX');
  return built.filename;
}
