// Image → voxel grid conversion. Turns a raster image (logo, sprite,
// pixel-art, small photo) into a standing billboard of colored voxels, then
// emits runnable editor code that rebuilds it via `voxels.decode(...)`.
//
// The pure conversion + codegen live here (unit-testable with a synthetic
// ImageData); the DOM step that turns a `File` into pixels lives in main.ts.

import { VoxelGrid, encodeGrid, COORD_MIN, COORD_MAX } from '../geometry/voxel/grid';

/** Minimal shape of the browser `ImageData` we consume (also satisfiable by a
 *  plain object in tests). */
export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA bytes, row-major, length `width * height * 4`. */
  data: Uint8ClampedArray | Uint8Array | number[];
}

export interface ImageToVoxelOptions {
  /** Longest side after downsampling. The grid axis range caps this anyway. */
  maxSize?: number;
  /** How many voxels deep to extrude the image along Y. */
  depth?: number;
  /** Minimum alpha (0–255) for a pixel to become a voxel. Lets transparent
   *  PNG/sprite backgrounds drop out; opaque photos become a full slab. */
  alphaThreshold?: number;
}

const DEFAULTS = { maxSize: 64, depth: 1, alphaThreshold: 128 };
// Cap so a pathological maxSize can't exceed the grid's coordinate range.
const HARD_MAX = Math.min(256, COORD_MAX - COORD_MIN);

/** Convert image pixels into a centered, upright voxel billboard.
 *
 *  Mapping: image column → X (centered on 0), image row → Z (row 0 at the
 *  top, so the picture stands upright on the ground plane), extruded `depth`
 *  voxels along +Y. */
export function imageDataToVoxelGrid(image: ImageDataLike, options: ImageToVoxelOptions = {}): VoxelGrid {
  const maxSize = Math.max(1, Math.min(Math.floor(options.maxSize ?? DEFAULTS.maxSize), HARD_MAX));
  const depth = Math.max(1, Math.floor(options.depth ?? DEFAULTS.depth));
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? DEFAULTS.alphaThreshold));

  const { width: sw, height: sh, data } = image;
  if (sw <= 0 || sh <= 0) return new VoxelGrid();

  // Downsample (nearest-neighbor) so the longest side fits maxSize.
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));

  const grid = new VoxelGrid();
  const offX = Math.floor(tw / 2); // center horizontally on X=0

  for (let ty = 0; ty < th; ty++) {
    // Nearest source row for this target row.
    const sy = Math.min(sh - 1, Math.floor((ty / th) * sh));
    for (let tx = 0; tx < tw; tx++) {
      const sx = Math.min(sw - 1, Math.floor((tx / tw) * sw));
      const p = (sy * sw + sx) * 4;
      const a = data[p + 3];
      if (a < alphaThreshold) continue;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const x = tx - offX;
      const z = th - 1 - ty; // flip so image top is high Z; base sits at Z=0
      for (let y = 0; y < depth; y++) grid.set(x, y, z, [r, g, b]);
    }
  }
  return grid;
}

/** Emit editor code that rebuilds a grid via `voxels.decode(...)`. Mirrors the
 *  imported-mesh codegen: human-readable header, one self-contained `return`. */
export function generateVoxelImportCode(grid: VoxelGrid, filename: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const b = grid.bounds();
  const dims = b
    ? `${b.max[0] - b.min[0] + 1}×${b.max[1] - b.min[1] + 1}×${b.max[2] - b.min[2] + 1}`
    : '0×0×0';
  const encoded = encodeGrid(grid);
  return `// Imported from ${filename} on ${date}
// ${grid.size} voxels (${dims}). Edit below — e.g. add v.fillBox(...) before returning.
const { voxels } = api;
const v = voxels.decode(${JSON.stringify(encoded)});
return v;
`;
}
