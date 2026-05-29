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
    '000000ffffffccffffccccff99ffff99ccff9999ff66ffff66ccff6699ff6666ff' +
    '33ffff33ccff3399ff3366ff3333ff00ffff00ccff0099ff0066ff0033ff0000ff' +
    'ffffccccffcc99ffcc66ffcc33ffcc00ffccffcccccccccc99cccc66cccc33cccc' +
    '00ccccffcc99cccc99999c9966999933999900999cff99ccff9999ff9966ff9933' +
    'ff9900ff99ffcc99cccc999c9966999933999900999ccc99ccc9999cc9966cc99' +
    '33cc9900cc99ff9999cc9999996666996633996600996699cc6699996666996633' +
    '996600996600cc99006699003399000099006666666666666633666600666600cc' +
    '666600996666cc6633cc6633996633666633336633006633009966009933009900' +
    '00ff0033cc0033990033660033330033000033003366000099000066000033ff00' +
    '00cc000099000066000033000000ff0000cc000099000066000033000000ff0000' +
    'cc000099000066000033000000ff3300ff00006666333300336600336699003366' +
    'cc003366ff003399ff0033cc99003300660033ff990033cc990033999900336699' +
    '003333990033006600660066336666336633ff66339966336699cc669966ff6699' +
    '9933996699cc66cc99cc66ff99cc66cc6699cc3366cc0066cccc66cc99cccc6666' +
    'ccff66cc99ffcc6699cc9966cc99cc66cc99ff66cccc66ccccff66cccccc66cc99' +
    '00000000ddddddbbbbbb88888855555522222200dddd00bbbb0088880055550022' +
    '22dd0000bb0000880000550000220000dd000000bb000000880000550000220000'
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
