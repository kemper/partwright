// `partwright photo` — turn a raster photo into a palette-constrained voxel
// model, headless and fast. It is the CLI front door to the SAME image→voxel
// pipeline the in-app import modal uses (src/import/imageToVoxel.ts): downsample
// → tonal adjust → snap every pixel to the nearest palette colour (perceptual
// LAB distance) → optional background removal → emit runnable `voxels.decode(…)`
// editor code. We also mesh the grid here (src/geometry/voxel/mesher.ts) and
// hand it to the shared 4-view rasterizer so one command gives you the model
// code, a preview PNG, and stats — the inner loop for iterating on a photo.
//
// sharp does the file decode + EXIF auto-orient + high-quality resize on the
// main thread; the TS pipeline modules load via Vite SSR (same trick as
// scripts/cli/preview.mjs), so there is one source of truth and no drift.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';
import { composePng } from './preview.mjs';

// The app's out-of-the-box palette (mirrors DEFAULT_FILAMENTS in
// src/color/palette.ts) — used when no --palette file is given.
const DEFAULT_PALETTE = [
  { name: 'White', hex: '#f5f5f0' }, { name: 'Black', hex: '#181818' },
  { name: 'Red', hex: '#c02525' }, { name: 'Yellow', hex: '#e8c024' },
  { name: 'Blue', hex: '#2452c0' }, { name: 'Gray', hex: '#808080' },
];

function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Load a palette JSON file: accepts `["#rrggbb", …]` or `[{name,hex}, …]`.
 *  Returns `{ rgb: [[r,g,b],…], names: [name|null,…] }`. */
export function loadPalette(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`palette file ${file} must be a JSON array`);
  const rgb = [], names = [];
  for (const entry of raw) {
    const hex = typeof entry === 'string' ? entry : entry?.hex;
    if (!hex) continue;
    rgb.push(hexToRgb(hex));
    names.push(typeof entry === 'object' ? (entry.name ?? null) : null);
  }
  if (!rgb.length) throw new Error(`palette file ${file} had no usable colours`);
  return { rgb, names };
}

/** Decode + orient + (optionally crop) + downsample a photo to an RGBA
 *  ImageData-like the voxel pipeline consumes. We resize with a quality kernel
 *  HERE so the pipeline's own nearest-neighbour downsample is a no-op — area
 *  averaging beats point-sampling a 12-megapixel photo down to 64px. */
async function loadImageData(file, { max, crop }) {
  let img = sharp(file).rotate(); // EXIF auto-orient
  if (crop) {
    const [left, top, width, height] = crop;
    img = img.extract({ left, top, width, height });
  }
  img = img.resize(max, max, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Tally palette usage so the CLI can report which slots a photo actually used. */
function paletteHistogram(grid, palette, names) {
  const key = (r, g, b) => (r << 16) | (g << 8) | b;
  const want = new Map(palette.map(([r, g, b], i) => [key(r, g, b), i]));
  const counts = new Array(palette.length).fill(0);
  grid.forEach((_x, _y, _z, rgb) => {
    const i = want.get(rgb & 0xffffff);
    if (i !== undefined) counts[i]++;
  });
  return counts
    .map((count, i) => ({ slot: i + 1, name: names[i], hex: '#' + ((palette[i][0] << 16) | (palette[i][1] << 8) | palette[i][2]).toString(16).padStart(6, '0'), voxels: count }))
    .filter((e) => e.voxels > 0)
    .sort((a, b) => b.voxels - a.voxels);
}

/** Core: photo file + options → { code, mesh, grid, stats }. Loads the TS
 *  pipeline via SSR so the codegen matches the app exactly. */
export async function runPhoto(file, opts = {}) {
  const max = opts.max ?? 64;
  const { rgb: palette, names } = opts.palette ?? { rgb: DEFAULT_PALETTE.map((p) => hexToRgb(p.hex)), names: DEFAULT_PALETTE.map((p) => p.name) };
  const image = await loadImageData(file, { max, crop: opts.crop });

  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  try {
    const i2v = await server.ssrLoadModule('/src/import/imageToVoxel.ts');
    const mesher = await server.ssrLoadModule('/src/geometry/voxel/mesher.ts');

    const grid = i2v.imageDataToVoxelGrid(image, {
      // The image is already sized to `max`; cap downsample at its longest side
      // so the pipeline keeps every pixel we handed it (scale = 1).
      maxSize: Math.max(image.width, image.height),
      mode: opts.mode ?? 'billboard',
      depth: opts.depth ?? 1,
      maxHeight: opts.maxHeight ?? 16,
      baseThickness: opts.baseThickness ?? 1,
      invert: opts.invert ?? false,
      palette,
      removeBackground: opts.removeBackground ?? false,
      ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
      brightness: opts.brightness ?? 0,
      contrast: opts.contrast ?? 0,
      saturation: opts.saturation ?? 0,
    });

    const code = i2v.generateVoxelImportCode(grid, basename(file), { style: opts.codeStyle ?? 'decode' });
    const mesh = mesher.meshGrid(grid);
    const b = grid.bounds();
    const dims = b ? { x: b.max[0] - b.min[0] + 1, y: b.max[1] - b.min[1] + 1, z: b.max[2] - b.min[2] + 1 } : { x: 0, y: 0, z: 0 };
    const stats = {
      voxelCount: grid.size,
      dims,
      sampled: { width: image.width, height: image.height },
      paletteUsed: paletteHistogram(grid, palette, names),
    };
    return { code, mesh, grid, stats };
  } finally {
    await server.close();
  }
}

/** Compose a 4-view PNG from a voxel mesh (per-triangle colours). */
export function meshToPng(mesh, size = 480) {
  const p = mesh.vertProperties;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
    if (p[i + 2] < minZ) minZ = p[i + 2]; if (p[i + 2] > maxZ) maxZ = p[i + 2];
  }
  const bbox = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  return composePng(mesh.vertProperties, mesh.triVerts, mesh.triColors, bbox, size);
}
