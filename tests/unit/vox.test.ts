import { describe, it, expect } from 'vitest';
import { parseVox, _defaultPaletteForTests } from '../../src/import/parsers/vox';

// Hand-build a tiny .vox blob: MAIN > SIZE + XYZI with N voxels, optional
// RGBA. The format is dead simple so we can do this without a fixture file:
// uint32 LE for chunk content sizes; XYZI = uint32 count + N×(x,y,z,i bytes).

interface XYZI { x: number; y: number; z: number; i: number }

function buildVox(opts: {
  size: { x: number; y: number; z: number };
  voxels: XYZI[];
  rgba?: number[]; // 256 RGBA-packed numbers (0xRRGGBBAA); omit to use default palette
}): Uint8Array {
  const sizeChunk = new Uint8Array(12 + 12);
  const sdv = new DataView(sizeChunk.buffer);
  sizeChunk[0] = 0x53; sizeChunk[1] = 0x49; sizeChunk[2] = 0x5a; sizeChunk[3] = 0x45; // "SIZE"
  sdv.setUint32(4, 12, true);
  sdv.setUint32(8, 0, true);
  sdv.setUint32(12, opts.size.x, true);
  sdv.setUint32(16, opts.size.y, true);
  sdv.setUint32(20, opts.size.z, true);

  const xyziContent = 4 + opts.voxels.length * 4;
  const xyziChunk = new Uint8Array(12 + xyziContent);
  const xdv = new DataView(xyziChunk.buffer);
  xyziChunk[0] = 0x58; xyziChunk[1] = 0x59; xyziChunk[2] = 0x5a; xyziChunk[3] = 0x49; // "XYZI"
  xdv.setUint32(4, xyziContent, true);
  xdv.setUint32(8, 0, true);
  xdv.setUint32(12, opts.voxels.length, true);
  for (let k = 0; k < opts.voxels.length; k++) {
    const v = opts.voxels[k];
    const off = 16 + k * 4;
    xyziChunk[off] = v.x; xyziChunk[off + 1] = v.y; xyziChunk[off + 2] = v.z; xyziChunk[off + 3] = v.i;
  }

  let rgbaChunk: Uint8Array | null = null;
  if (opts.rgba) {
    rgbaChunk = new Uint8Array(12 + 1024);
    const rdv = new DataView(rgbaChunk.buffer);
    rgbaChunk[0] = 0x52; rgbaChunk[1] = 0x47; rgbaChunk[2] = 0x42; rgbaChunk[3] = 0x41; // "RGBA"
    rdv.setUint32(4, 1024, true);
    rdv.setUint32(8, 0, true);
    for (let i = 0; i < 256; i++) {
      const c = opts.rgba[i] ?? 0;
      rgbaChunk[12 + i * 4]     = (c >>> 24) & 0xff;
      rgbaChunk[12 + i * 4 + 1] = (c >>> 16) & 0xff;
      rgbaChunk[12 + i * 4 + 2] = (c >>> 8) & 0xff;
      rgbaChunk[12 + i * 4 + 3] = c & 0xff;
    }
  }

  const childrenBytes = sizeChunk.length + xyziChunk.length + (rgbaChunk?.length ?? 0);
  const mainChunk = new Uint8Array(12);
  mainChunk[0] = 0x4d; mainChunk[1] = 0x41; mainChunk[2] = 0x49; mainChunk[3] = 0x4e; // "MAIN"
  const mdv = new DataView(mainChunk.buffer);
  mdv.setUint32(4, 0, true);              // no content (data lives in children)
  mdv.setUint32(8, childrenBytes, true);  // children size

  // 8-byte file header: "VOX " + version uint32
  const header = new Uint8Array(8);
  header[0] = 0x56; header[1] = 0x4f; header[2] = 0x58; header[3] = 0x20;
  new DataView(header.buffer).setUint32(4, 150, true);

  const out = new Uint8Array(header.length + mainChunk.length + childrenBytes);
  let off = 0;
  out.set(header, off); off += header.length;
  out.set(mainChunk, off); off += mainChunk.length;
  out.set(sizeChunk, off); off += sizeChunk.length;
  out.set(xyziChunk, off); off += xyziChunk.length;
  if (rgbaChunk) out.set(rgbaChunk, off);
  return out;
}

describe('parseVox', () => {
  it('rejects files without the VOX magic', () => {
    expect(() => parseVox(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toThrow(/VOX/);
  });

  it('parses a single voxel with the default palette', () => {
    const bytes = buildVox({
      size: { x: 1, y: 1, z: 1 },
      voxels: [{ x: 0, y: 0, z: 0, i: 1 }],
    });
    const grid = parseVox(bytes);
    expect(grid.size).toBe(1);
    // The center-on-origin remap takes (0,0) at size 1×1 to (0,0) — floor(1/2) = 0.
    expect(grid.has(0, 0, 0)).toBe(true);
    expect(grid.get(0, 0, 0)).toBe(_defaultPaletteForTests[1]);
  });

  it('uses a custom palette when an RGBA chunk is present', () => {
    // Custom palette index 1 = pure red; file slot 0 holds palette index 1.
    const rgba = new Array(256).fill(0);
    rgba[0] = 0xff0000ff; // index 1 → 0xff0000
    rgba[1] = 0x00ff00ff; // index 2 → 0x00ff00
    const bytes = buildVox({
      size: { x: 2, y: 2, z: 1 },
      voxels: [
        { x: 0, y: 0, z: 0, i: 1 },
        { x: 1, y: 1, z: 0, i: 2 },
      ],
      rgba,
    });
    const grid = parseVox(bytes);
    expect(grid.size).toBe(2);
    // size 2×2×1 centered: cx=cy=floor(2/2)=1, so voxel (0,0) → (-1,-1).
    expect(grid.get(-1, -1, 0)).toBe(0xff0000);
    expect(grid.get(0, 0, 0)).toBe(0x00ff00);
  });

  it('centers larger models around the origin and sits them on z=0', () => {
    const voxels: XYZI[] = [];
    for (let x = 0; x < 4; x++) voxels.push({ x, y: 0, z: 0, i: 1 });
    const bytes = buildVox({ size: { x: 4, y: 4, z: 4 }, voxels });
    const grid = parseVox(bytes);
    const b = grid.bounds()!;
    expect(b.min[0]).toBe(-2); // size 4 → cx=2 → x∈[-2,1]
    expect(b.max[0]).toBe(1);
    expect(b.min[2]).toBe(0);  // z untouched
  });

  it('throws clearly when there is no SIZE/XYZI pair', () => {
    // Build a header + empty MAIN.
    const out = new Uint8Array(20);
    out[0] = 0x56; out[1] = 0x4f; out[2] = 0x58; out[3] = 0x20;
    new DataView(out.buffer).setUint32(4, 150, true);
    out[8] = 0x4d; out[9] = 0x41; out[10] = 0x49; out[11] = 0x4e;
    expect(() => parseVox(out)).toThrow(/no model/);
  });

  it('throws on a truncated chunk', () => {
    const bytes = buildVox({ size: { x: 1, y: 1, z: 1 }, voxels: [{ x: 0, y: 0, z: 0, i: 1 }] });
    // Lop off the last 4 bytes (mid-XYZI content). The walker must notice.
    expect(() => parseVox(bytes.subarray(0, bytes.length - 4))).toThrow(/past EOF|Truncated/);
  });

  it('default palette is the full, correct 256-entry MagicaVoxel table', () => {
    // Regression: the literal was previously truncated/misaligned, so only the
    // low indices were right and high indices collapsed to black. Probe known
    // canonical values across the whole range — not just index 1, which is
    // white either way and so masked the bug.
    const pal = _defaultPaletteForTests;
    expect(pal).toHaveLength(256);
    // A too-short literal yields NaN (parseInt of '') → coerced to 0; assert
    // every entry is a valid 0xRRGGBB integer.
    expect(pal.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff)).toBe(true);
    // Spot-check canonical entries (0xRRGGBB) from the format spec across the
    // early gradient, the deep range, and the grayscale tail.
    expect(pal[0]).toBe(0x000000); // reserved
    expect(pal[1]).toBe(0xffffff);
    expect(pal[2]).toBe(0xccffff);
    expect(pal[3]).toBe(0x99ffff); // first index the old corrupt table got wrong
    expect(pal[36]).toBe(0x0000ff);
    expect(pal[200]).toBe(0xcc6600); // deep in the range the old table dropped
    expect(pal[246]).toBe(0xeeeeee); // grayscale ramp
    expect(pal[255]).toBe(0x111111); // last entry
    // The tail must not be all-black — the old truncation made ~70 entries 0.
    expect(pal.slice(186).some((v) => v !== 0x000000)).toBe(true);
  });
});

// ── Scene-graph (multi-object) import ──────────────────────────────────────
// MagicaVoxel positions each object through nTRN/nGRP/nSHP nodes. These tests
// hand-build files with that graph to prove all models assemble at their world
// positions (with rotation), instead of collapsing to model 0.

/** Little-endian byte writer for the extension-chunk encodings. */
class W {
  b: number[] = [];
  i32(v: number): this { this.b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); return this; }
  str(s: string): this { this.i32(s.length); for (let i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i) & 0xff); return this; }
  dict(e: [string, string][]): this { this.i32(e.length); for (const [k, v] of e) this.str(k).str(v); return this; }
  out(): Uint8Array { return new Uint8Array(this.b); }
}

function chunk(id: string, content: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + content.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, content.length, true);
  out.set(content, 12);
  return out;
}

function sizeChunk(x: number, y: number, z: number): Uint8Array {
  return chunk('SIZE', new W().i32(x).i32(y).i32(z).out());
}
function xyziChunk(voxels: XYZI[]): Uint8Array {
  const w = new W().i32(voxels.length);
  for (const v of voxels) w.b.push(v.x & 0xff, v.y & 0xff, v.z & 0xff, v.i & 0xff);
  return chunk('XYZI', w.out());
}
function rgbaChunk(rgb: Record<number, number>): Uint8Array {
  // rgb maps 1-based palette index → 0xRRGGBB; file slot k holds index k+1.
  const w = new W();
  for (let i = 0; i < 256; i++) {
    const c = rgb[i + 1] ?? 0;
    w.b.push((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 0xff);
  }
  return chunk('RGBA', w.out());
}
function trnChunk(nodeId: number, childId: number, t?: [number, number, number], rByte?: number): Uint8Array {
  const frame: [string, string][] = [];
  if (t) frame.push(['_t', `${t[0]} ${t[1]} ${t[2]}`]);
  if (rByte !== undefined) frame.push(['_r', String(rByte)]);
  return chunk('nTRN', new W().i32(nodeId).dict([]).i32(childId).i32(-1).i32(0).i32(1).dict(frame).out());
}
function grpChunk(nodeId: number, children: number[]): Uint8Array {
  const w = new W().i32(nodeId).dict([]).i32(children.length);
  for (const c of children) w.i32(c);
  return chunk('nGRP', w.out());
}
function shpChunk(nodeId: number, modelId: number): Uint8Array {
  return chunk('nSHP', new W().i32(nodeId).dict([]).i32(1).i32(modelId).dict([]).out());
}

/** Wrap children under "VOX " + MAIN. */
function voxFile(children: Uint8Array[]): Uint8Array {
  const childrenLen = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + 12 + childrenLen);
  out[0] = 0x56; out[1] = 0x4f; out[2] = 0x58; out[3] = 0x20; // "VOX "
  const dv = new DataView(out.buffer);
  dv.setUint32(4, 150, true);
  out[8] = 0x4d; out[9] = 0x41; out[10] = 0x49; out[11] = 0x4e; // "MAIN"
  dv.setUint32(12, 0, true);
  dv.setUint32(16, childrenLen, true);
  let p = 20;
  for (const c of children) { out.set(c, p); p += c.length; }
  return out;
}

describe('parseVox scene graph', () => {
  it('assembles two models at their scene-graph positions', () => {
    // model0 (red) at origin, model1 (green) translated +10 in x.
    const bytes = voxFile([
      sizeChunk(1, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 1 }]),
      sizeChunk(1, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 2 }]),
      trnChunk(0, 1), // root → group 1
      grpChunk(1, [2, 4]), // group → two shape transforms
      trnChunk(2, 3, [0, 0, 0]), shpChunk(3, 0), // model 0 at origin
      trnChunk(4, 5, [10, 0, 0]), shpChunk(5, 1), // model 1 at +10 x
      rgbaChunk({ 1: 0xff0000, 2: 0x00ff00 }),
    ]);
    const grid = parseVox(bytes);
    expect(grid.size).toBe(2);
    // Scene spans x∈[0,10] → centered offset 5; both sit on z=0.
    expect(grid.get(-5, 0, 0)).toBe(0xff0000);
    expect(grid.get(5, 0, 0)).toBe(0x00ff00);
  });

  it('drops all-but-model-0 when an explicit modelIndex bypasses the graph', () => {
    const bytes = voxFile([
      sizeChunk(1, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 1 }]),
      sizeChunk(1, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 2 }]),
      trnChunk(0, 1), grpChunk(1, [2, 4]),
      trnChunk(2, 3, [0, 0, 0]), shpChunk(3, 0),
      trnChunk(4, 5, [10, 0, 0]), shpChunk(5, 1),
      rgbaChunk({ 1: 0xff0000, 2: 0x00ff00 }),
    ]);
    // modelIndex picks exactly one model and ignores the scene graph.
    expect(parseVox(bytes, { modelIndex: 1 }).size).toBe(1);
    expect([...vals(parseVox(bytes, { modelIndex: 1 }))]).toEqual([0x00ff00]);
  });

  it('applies a 90°-about-Z rotation from the _r byte', () => {
    // A 3-long line along local x; _r byte 17 maps (x,y,z) → (-y, x, z), so the
    // line ends up along y. Proves the rotation matrix is decoded and applied.
    const line: XYZI[] = [
      { x: 0, y: 0, z: 0, i: 1 }, { x: 1, y: 0, z: 0, i: 1 }, { x: 2, y: 0, z: 0, i: 1 },
    ];
    const bytes = voxFile([
      sizeChunk(3, 1, 1), xyziChunk(line),
      trnChunk(0, 1), grpChunk(1, [2]),
      trnChunk(2, 3, [0, 0, 0], 17), shpChunk(3, 0),
      rgbaChunk({ 1: 0xffffff }),
    ]);
    const grid = parseVox(bytes);
    expect(grid.size).toBe(3);
    const b = grid.bounds()!;
    // Originally a line in x (Δx=2, Δy=0); after the rotation it's a line in y.
    expect(b.max[0] - b.min[0]).toBe(0); // collapsed in x
    expect(b.max[1] - b.min[1]).toBe(2); // extended in y
  });

  it('ignores an improper (mirroring) _r rotation byte and keeps identity', () => {
    // _r byte 20 decodes to a reflection (det = −1) — a mirror MagicaVoxel never
    // writes. The importer must decline to mirror: red stays on the −x side.
    const bytes = voxFile([
      sizeChunk(3, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 1 }, { x: 2, y: 0, z: 0, i: 2 }]),
      trnChunk(0, 1), grpChunk(1, [2]),
      trnChunk(2, 3, [0, 0, 0], 20), shpChunk(3, 0),
      rgbaChunk({ 1: 0xff0000, 2: 0x00ff00 }),
    ]);
    const grid = parseVox(bytes);
    expect(grid.size).toBe(2);
    // Identity: local-centered red at x=−1, green at x=+1. A reflection would
    // have swapped them; assert it did not.
    expect(grid.get(-1, 0, 0)).toBe(0xff0000);
    expect(grid.get(1, 0, 0)).toBe(0x00ff00);
  });

  it('falls back to the legacy path when a scene node is malformed', () => {
    // A truncated nTRN (claims a frame but the content ends) must not throw —
    // the importer ignores the bad node and centers model 0.
    const badTrn = chunk('nTRN', new W().i32(0).dict([]).i32(1).i32(-1).i32(0).i32(1).out()); // missing frame DICT
    const bytes = voxFile([
      sizeChunk(1, 1, 1), xyziChunk([{ x: 0, y: 0, z: 0, i: 1 }]),
      badTrn,
      rgbaChunk({ 1: 0xff0000 }),
    ]);
    const grid = parseVox(bytes);
    expect(grid.size).toBe(1);
    expect(grid.get(0, 0, 0)).toBe(0xff0000);
  });
});

function vals(grid: ReturnType<typeof parseVox>): number[] {
  const out: number[] = [];
  grid.forEach((_x, _y, _z, c) => out.push(c));
  return out;
}
