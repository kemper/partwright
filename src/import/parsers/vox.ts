// MagicaVoxel .vox file parser. The format is a tiny RIFF-style binary:
//
//   magic "VOX " + version (uint32, 150 commonly)
//   MAIN chunk wrapping the rest as children:
//     PACK   (optional)        — number of models in the file
//     SIZE  + XYZI repeated    — one pair per model (dims + occupancy)
//     RGBA  (optional)         — 256-entry palette; if absent use the default
//
// Each XYZI voxel is { x, y, z, i } with `i` a 1-based palette index.
//
// MagicaVoxel uses Z-up like Partwright — but Y is "depth" with X to the left
// (camera-relative). We map directly to our coordinate space without flipping
// so the model lands upright; users can `.mirror('x')` if they want the
// opposite-handed view.
//
// Reference: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
//
// Pure logic (no DOM/WASM): unit-tested in the vitest tier.

import { VoxelGrid, COORD_MIN, COORD_MAX } from '../../geometry/voxel/grid';

const MAGIC = [0x56, 0x4f, 0x58, 0x20]; // "VOX "

/** MagicaVoxel's default 256-entry palette (used when a .vox has no RGBA
 *  chunk). Packed as `0xRRGGBB` integers; alpha is ignored. Index 0 is
 *  reserved (transparent) and never stored in XYZI, so we leave its slot at
 *  0x000000 to keep the table 1-based-readable. Values match the canonical
 *  palette in the format spec. */
const DEFAULT_PALETTE: number[] = (() => {
  const hex = (
    '000000ffffffccffff99ffff66ffff33ffff00ffffffccffccccff99ccff66ccff33ccff00ccffff99ffcc99ff9999ff' +
    '6699ff3399ff0099ffff66ffcc66ff9966ff6666ff3366ff0066ffff33ffcc33ff9933ff6633ff3333ff0033ffff00ff' +
    'cc00ff9900ff6600ff3300ff0000ffffffccccffcc99ffcc66ffcc33ffcc00ffccffcccccccccc99cccc66cccc33cccc' +
    '00ccccff99cccc99cc9999cc6699cc3399cc0099ccff66cccc66cc9966cc6666cc3366cc0066ccff33cccc33cc9933cc' +
    '6633cc3333cc0033ccff00cccc00cc9900cc6600cc3300cc0000ccffff99ccff9999ff9966ff9933ff9900ff99ffcc99' +
    'cccc9999cc9966cc9933cc9900cc99ff9999cc9999999999669999339999009999ff6699cc6699996699666699336699' +
    '006699ff3399cc3399993399663399333399003399ff0099cc0099990099660099330099000099ffff66ccff6699ff66' +
    '66ff6633ff6600ff66ffcc66cccc6699cc6666cc6633cc6600cc66ff9966cc9966999966669966339966009966ff6666' +
    'cc6666996666666666336666006666ff3366cc3366993366663366333366003366ff0066cc0066990066660066330066' +
    '000066ffff33ccff3399ff3366ff3333ff3300ff33ffcc33cccc3399cc3366cc3333cc3300cc33ff9933cc9933999933' +
    '669933339933009933ff6633cc6633996633666633336633006633ff3333cc3333993333663333333333003333ff0033' +
    'cc0033990033660033330033000033ffff00ccff0099ff0066ff0033ff0000ff00ffcc00cccc0099cc0066cc0033cc00' +
    '00cc00ff9900cc9900999900669900339900009900ff6600cc6600996600666600336600006600ff3300cc3300993300' +
    '663300333300003300ff0000cc00009900006600003300000000ee0000dd0000bb0000aa000088000077000055000044' +
    '00002200001100ee0000dd0000bb0000aa00008800007700005500004400002200001100ee0000dd0000bb0000aa0000' +
    '880000770000550000440000220000110000eeeeeeddddddbbbbbbaaaaaa888888777777555555444444222222111111'
  );
  const out = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    const r = parseInt(hex.slice(i * 6, i * 6 + 2), 16);
    const g = parseInt(hex.slice(i * 6 + 2, i * 6 + 4), 16);
    const b = parseInt(hex.slice(i * 6 + 4, i * 6 + 6), 16);
    out[i] = (r << 16) | (g << 8) | b;
  }
  return out;
})();

export interface VoxParseOptions {
  /** When the file contains multiple models, this index picks one (default 0).
   *  Other models are silently ignored — multi-model placement belongs at a
   *  higher layer (where we'd want translation offsets / part-per-model). */
  modelIndex?: number;
}

/** Parse a MagicaVoxel `.vox` file into a {@link VoxelGrid}. Returns null and
 *  surfaces a clear error if the magic is missing or the file is truncated. */
export function parseVox(bytes: Uint8Array, options: VoxParseOptions = {}): VoxelGrid {
  if (bytes.length < 8 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new Error('Not a MagicaVoxel .vox file (missing "VOX " magic header).');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Collect the model SIZE/XYZI pairs and the palette as we walk the chunk
  // tree. MAIN's content lives between the header (12 bytes total) and EOF,
  // skipping MAIN's own chunkContentSize/childrenSize.
  if (bytes.length < 20) throw new Error('Truncated .vox file (no MAIN chunk).');
  const sizes: { x: number; y: number; z: number }[] = [];
  const voxels: { x: number; y: number; z: number; i: number }[][] = [];
  let palette: number[] | null = null;

  // Walk children of MAIN. MAIN's header occupies bytes [8, 20); its children
  // span [20, bytes.length).
  let p = 20;
  while (p + 12 <= bytes.length) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const contentSize = dv.getUint32(p + 4, true);
    // childrenSize at p + 8 — we don't recurse; every chunk we care about is
    // a leaf with no children at our walk depth.
    p += 12;
    const start = p;
    const end = start + contentSize;
    if (end > bytes.length) throw new Error(`.vox chunk "${id}" extends past EOF.`);

    if (id === 'SIZE' && contentSize >= 12) {
      sizes.push({
        x: dv.getUint32(start, true),
        y: dv.getUint32(start + 4, true),
        z: dv.getUint32(start + 8, true),
      });
    } else if (id === 'XYZI' && contentSize >= 4) {
      const n = dv.getUint32(start, true);
      const list: { x: number; y: number; z: number; i: number }[] = [];
      for (let k = 0; k < n; k++) {
        const off = start + 4 + k * 4;
        if (off + 4 > end) throw new Error('Truncated XYZI chunk.');
        list.push({ x: bytes[off], y: bytes[off + 1], z: bytes[off + 2], i: bytes[off + 3] });
      }
      voxels.push(list);
    } else if (id === 'RGBA' && contentSize >= 1024) {
      // 256 RGBA entries; the first slot (index 0) is reserved/transparent in
      // the file, but XYZI palette indices are 1-based — so file slot N stores
      // the color for palette index N+1, with the last slot unused. Shift by
      // one so palette[1] = file[0], matching XYZI's indexing.
      const pal = new Array<number>(256);
      pal[0] = 0x000000;
      for (let i = 0; i < 255; i++) {
        const r = bytes[start + i * 4];
        const g = bytes[start + i * 4 + 1];
        const b = bytes[start + i * 4 + 2];
        pal[i + 1] = (r << 16) | (g << 8) | b;
      }
      palette = pal;
    }
    p = end;
  }

  if (sizes.length === 0 || voxels.length === 0) {
    throw new Error('.vox file has no model (missing SIZE/XYZI chunks).');
  }
  const modelIndex = Math.max(0, Math.min(options.modelIndex ?? 0, voxels.length - 1));
  const cells = voxels[modelIndex];
  const size = sizes[modelIndex] ?? sizes[0];
  const pal = palette ?? DEFAULT_PALETTE;

  // Center the model horizontally and sit it on z=0, so it lands in the same
  // place an image-import would and at a coordinate range likely to fit.
  const cx = Math.floor(size.x / 2);
  const cy = Math.floor(size.y / 2);
  const grid = new VoxelGrid();
  for (const c of cells) {
    const x = c.x - cx;
    const y = c.y - cy;
    const z = c.z;
    if (x < COORD_MIN || x > COORD_MAX || y < COORD_MIN || y > COORD_MAX || z < COORD_MIN || z > COORD_MAX) {
      // The model exceeds the grid range — silently drop the out-of-range
      // voxels rather than fail the whole import. (The .vox spec allows up to
      // 256³, comfortably inside ±1024 once centered.)
      continue;
    }
    grid.set(x, y, z, pal[c.i] ?? 0xffffff);
  }
  return grid;
}

/** @internal exposed for tests so they can sanity-check the default palette. */
export const _defaultPaletteForTests = DEFAULT_PALETTE;
