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
});
