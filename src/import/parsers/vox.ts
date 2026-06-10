// MagicaVoxel .vox file parser. The format is a tiny RIFF-style binary:
//
//   magic "VOX " + version (uint32, 150 commonly)
//   MAIN chunk wrapping the rest as children:
//     PACK   (optional)        — number of models in the file
//     SIZE  + XYZI repeated    — one pair per model (dims + occupancy)
//     nTRN / nGRP / nSHP       — scene graph: positions each model in the world
//     RGBA  (optional)         — 256-entry palette; if absent use the default
//
// Each XYZI voxel is { x, y, z, i } with `i` a 1-based palette index.
//
// MagicaVoxel uses Z-up like Partwright — but Y is "depth" with X to the left
// (camera-relative). We map directly to our coordinate space without flipping
// so the model lands upright; users can `.mirror('x')` if they want the
// opposite-handed view.
//
// Multi-object scenes: MagicaVoxel stores each object as its own SIZE/XYZI
// model and positions it through a scene graph of transform (nTRN), group
// (nGRP), and shape (nSHP) nodes. We traverse that graph from the root node,
// compose each node's translation + rotation, and assemble every shape into one
// grid at its world position — so a multi-part scene imports whole instead of
// collapsing to model 0. Files with no scene graph (older single-model exports,
// and the synthetic fixtures in our tests) fall back to the legacy single-model
// path that centers one model around the origin.
//
// Reference: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
//            https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox-extension.txt
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
  /** Force the legacy single-model path and pick this model by index, ignoring
   *  any scene graph. When omitted (the default), a multi-object scene is
   *  assembled whole via its scene graph; pass an index only to extract one
   *  specific model from a multi-model file. */
  modelIndex?: number;
}

/** A signed-permutation rotation: row `i` of the matrix has its single non-zero
 *  entry at column `cols[i]` with sign `signs[i]`. Applying it to a vector `v`
 *  yields `[signs[0]*v[cols[0]], signs[1]*v[cols[1]], signs[2]*v[cols[2]]]`. */
interface Rot {
  cols: [number, number, number];
  signs: [number, number, number];
}

const IDENTITY_ROT: Rot = { cols: [0, 1, 2], signs: [1, 1, 1] };

/** Decode a MagicaVoxel `_r` rotation byte into a {@link Rot}. Bits 0–1 and 2–3
 *  give the non-zero column of rows 0 and 1; row 2's column is whichever index
 *  remains. Bits 4–6 are the per-row signs (1 = negative). Falls back to
 *  identity for a malformed byte (rows 0 and 1 sharing a column). */
function decodeRotation(byte: number): Rot {
  const c0 = byte & 0b11;
  const c1 = (byte >> 2) & 0b11;
  if (c0 > 2 || c1 > 2 || c0 === c1) return IDENTITY_ROT;
  const c2 = 3 - c0 - c1; // the remaining index of {0,1,2}
  const s0 = (byte >> 4) & 1 ? -1 : 1;
  const s1 = (byte >> 5) & 1 ? -1 : 1;
  const s2 = (byte >> 6) & 1 ? -1 : 1;
  return { cols: [c0, c1, c2], signs: [s0, s1, s2] };
}

/** Apply a rotation to an integer vector. */
function applyRot(r: Rot, v: [number, number, number]): [number, number, number] {
  return [r.signs[0] * v[r.cols[0]], r.signs[1] * v[r.cols[1]], r.signs[2] * v[r.cols[2]]];
}

/** Compose two rotations: `parent ∘ local` (apply local first, then parent). */
function composeRot(parent: Rot, local: Rot): Rot {
  const cols = [0, 1, 2].map((i) => local.cols[parent.cols[i]]) as [number, number, number];
  const signs = [0, 1, 2].map((i) => parent.signs[i] * local.signs[parent.cols[i]]) as [number, number, number];
  return { cols, signs };
}

/** A composed world transform (translation + rotation) for a scene-graph node. */
interface Xform {
  t: [number, number, number];
  r: Rot;
}

const IDENTITY_XFORM: Xform = { t: [0, 0, 0], r: IDENTITY_ROT };

/** Compose two transforms: place `local` inside `parent`'s frame. */
function composeXform(parent: Xform, local: Xform): Xform {
  const rt = applyRot(parent.r, local.t);
  return {
    t: [parent.t[0] + rt[0], parent.t[1] + rt[1], parent.t[2] + rt[2]],
    r: composeRot(parent.r, local.r),
  };
}

interface TrnNode { childId: number; xform: Xform }
interface GrpNode { children: number[] }
interface ShpNode { models: number[] }

/** Cursor over a chunk's content for reading the extension chunk encodings.
 *  Throws `RangeError` past `end` so a malformed scene node is caught and the
 *  import falls back to the legacy single-model path rather than corrupting. */
class ChunkReader {
  private dv: DataView;
  p: number;
  private end: number;
  constructor(dv: DataView, p: number, end: number) {
    this.dv = dv;
    this.p = p;
    this.end = end;
  }
  private require(n: number): void {
    if (this.p + n > this.end) throw new RangeError('scene-graph chunk truncated');
  }
  int32(): number { this.require(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  uint32(): number { this.require(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  /** STRING: int32 length + raw bytes (no terminator). */
  string(): string {
    const len = this.uint32();
    this.require(len);
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.dv.getUint8(this.p + i));
    this.p += len;
    return s;
  }
  /** DICT: int32 pair count, then STRING key / STRING value pairs. */
  dict(): Map<string, string> {
    const n = this.uint32();
    const m = new Map<string, string>();
    for (let i = 0; i < n; i++) {
      const k = this.string();
      m.set(k, this.string());
    }
    return m;
  }
}

/** Parse a `_t` translation string ("x y z") into a vector, or null. */
function parseTranslation(s: string | undefined): [number, number, number] | null {
  if (!s) return null;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

/** Walk the scene graph from the root and place every shape's model(s) into the
 *  output via `place`. Returns false if the graph yielded no shapes (so the
 *  caller can fall back to the legacy single-model path). */
function traverseScene(
  trn: Map<number, TrnNode>,
  grp: Map<number, GrpNode>,
  shp: Map<number, ShpNode>,
  place: (modelId: number, xform: Xform) => void,
): boolean {
  if (trn.size === 0 && grp.size === 0 && shp.size === 0) return false;
  let placedAny = false;
  const seen = new Set<number>();
  const visit = (nodeId: number, xform: Xform): void => {
    if (seen.has(nodeId)) return; // guard against a cyclic/corrupt graph
    seen.add(nodeId);
    const t = trn.get(nodeId);
    if (t) { visit(t.childId, composeXform(xform, t.xform)); return; }
    const g = grp.get(nodeId);
    if (g) { for (const child of g.children) visit(child, xform); return; }
    const s = shp.get(nodeId);
    if (s) { for (const modelId of s.models) { place(modelId, xform); placedAny = true; } }
  };
  visit(0, IDENTITY_XFORM); // MagicaVoxel's root node is always id 0
  return placedAny;
}

/** Parse a MagicaVoxel `.vox` file into a {@link VoxelGrid}. Returns null and
 *  surfaces a clear error if the magic is missing or the file is truncated. */
export function parseVox(bytes: Uint8Array, options: VoxParseOptions = {}): VoxelGrid {
  if (bytes.length < 8 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new Error('Not a MagicaVoxel .vox file (missing "VOX " magic header).');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Collect the model SIZE/XYZI pairs, the palette, and the scene-graph nodes
  // as we walk the chunk tree. MAIN's content lives between the header (12
  // bytes total) and EOF, skipping MAIN's own chunkContentSize/childrenSize.
  if (bytes.length < 20) throw new Error('Truncated .vox file (no MAIN chunk).');
  const sizes: { x: number; y: number; z: number }[] = [];
  const voxels: { x: number; y: number; z: number; i: number }[][] = [];
  let palette: number[] | null = null;
  const trn = new Map<number, TrnNode>();
  const grp = new Map<number, GrpNode>();
  const shp = new Map<number, ShpNode>();

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
    } else if (id === 'nTRN' || id === 'nGRP' || id === 'nSHP') {
      // Scene-graph nodes. Parse defensively: a malformed node is skipped (the
      // import then falls back to the legacy single-model path).
      try {
        const rd = new ChunkReader(dv, start, end);
        const nodeId = rd.int32();
        rd.dict(); // node attributes (_name, _hidden) — unused
        if (id === 'nTRN') {
          const childId = rd.int32();
          rd.int32(); // reserved (-1)
          rd.int32(); // layer id
          const numFrames = rd.uint32();
          let xform = IDENTITY_XFORM;
          for (let f = 0; f < numFrames; f++) {
            const frame = rd.dict();
            if (f === 0) {
              const t = parseTranslation(frame.get('_t')) ?? [0, 0, 0];
              const rByte = frame.has('_r') ? parseInt(frame.get('_r')!, 10) : NaN;
              const r = Number.isFinite(rByte) ? decodeRotation(rByte) : IDENTITY_ROT;
              xform = { t, r };
            }
          }
          trn.set(nodeId, { childId, xform });
        } else if (id === 'nGRP') {
          const numChildren = rd.uint32();
          const children: number[] = [];
          for (let c = 0; c < numChildren; c++) children.push(rd.int32());
          grp.set(nodeId, { children });
        } else {
          const numModels = rd.uint32();
          const models: number[] = [];
          for (let m = 0; m < numModels; m++) {
            models.push(rd.int32());
            rd.dict(); // per-model attributes (_f frame index) — unused
          }
          shp.set(nodeId, { models });
        }
      } catch {
        // Malformed scene node — ignore it; legacy fallback covers the file.
      }
    }
    p = end;
  }

  if (sizes.length === 0 || voxels.length === 0) {
    throw new Error('.vox file has no model (missing SIZE/XYZI chunks).');
  }
  const pal = palette ?? DEFAULT_PALETTE;
  const colorOf = (i: number): number => pal[i] ?? 0xffffff;

  // Multi-object path: when no explicit model index was requested, assemble the
  // whole scene through its graph so every positioned part lands correctly.
  if (options.modelIndex === undefined) {
    const placed: { x: number; y: number; z: number; c: number }[] = [];
    const place = (modelId: number, xform: Xform): void => {
      const size = sizes[modelId];
      const cells = voxels[modelId];
      if (!size || !cells) return; // shape references a model the file didn't ship
      // MagicaVoxel's transform positions the model by its center; the center
      // in local voxel space is floor(size/2) per axis.
      const cx = Math.floor(size.x / 2), cy = Math.floor(size.y / 2), cz = Math.floor(size.z / 2);
      for (const c of cells) {
        const lv: [number, number, number] = [c.x - cx, c.y - cy, c.z - cz];
        const rv = applyRot(xform.r, lv);
        placed.push({
          x: xform.t[0] + rv[0],
          y: xform.t[1] + rv[1],
          z: xform.t[2] + rv[2],
          c: colorOf(c.i),
        });
      }
    };
    if (traverseScene(trn, grp, shp, place) && placed.length > 0) {
      return assemblePlaced(placed);
    }
  }

  // Legacy single-model path: no scene graph (or an explicit modelIndex). Pick
  // one model and center it horizontally, sitting it on z=0 — so it lands where
  // an image-import would, in a coordinate range likely to fit.
  const modelIndex = Math.max(0, Math.min(options.modelIndex ?? 0, voxels.length - 1));
  const cells = voxels[modelIndex];
  const size = sizes[modelIndex] ?? sizes[0];
  const cx = Math.floor(size.x / 2);
  const cy = Math.floor(size.y / 2);
  const grid = new VoxelGrid();
  for (const c of cells) {
    const x = c.x - cx;
    const y = c.y - cy;
    const z = c.z;
    if (!inRange(x, y, z)) continue; // drop out-of-range voxels rather than fail
    grid.set(x, y, z, colorOf(c.i));
  }
  return grid;
}

/** True if a voxel coordinate sits inside the grid's addressable range. */
function inRange(x: number, y: number, z: number): boolean {
  return x >= COORD_MIN && x <= COORD_MAX
    && y >= COORD_MIN && y <= COORD_MAX
    && z >= COORD_MIN && z <= COORD_MAX;
}

/** Normalize a set of world-space voxels into a grid: center the whole scene
 *  horizontally about the origin and sit its lowest layer on z=0, preserving
 *  the relative placement of every part. Out-of-range voxels are dropped. */
function assemblePlaced(placed: { x: number; y: number; z: number; c: number }[]): VoxelGrid {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (const v of placed) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
  }
  const offX = Math.floor((minX + maxX) / 2);
  const offY = Math.floor((minY + maxY) / 2);
  const grid = new VoxelGrid();
  for (const v of placed) {
    const x = v.x - offX, y = v.y - offY, z = v.z - minZ;
    if (!inRange(x, y, z)) continue;
    grid.set(x, y, z, v.c);
  }
  return grid;
}

/** @internal exposed for tests so they can sanity-check the default palette. */
export const _defaultPaletteForTests = DEFAULT_PALETTE;
