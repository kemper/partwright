import { describe, it, expect, vi, afterEach } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildZip, buildZipAsync, crc32, type ZipEntry } from '../../src/export/zip';
import { openZip } from '../../src/import/zipReader';
import { build3MFProject, build3MFProjectAsync } from '../../src/export/threemfProject';
import { build3MF, build3MFAsync } from '../../src/export/threemf';
import { parse3MF } from '../../src/import/parsers/threemf';
import type { MeshData } from '../../src/geometry/types';

const enc = (s: string) => new TextEncoder().encode(s);

/** Bit-at-a-time reference CRC-32 — independent of the table-driven one in zip.ts. */
function refCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface RawEntry { name: string; method: number; crc: number; compSize: number; size: number; localOffset: number; payload: Uint8Array }

/** Independent ZIP walk: central directory + local headers, cross-checked. */
function walkZip(bytes: Uint8Array): RawEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  let p = v.getUint32(eocd + 16, true);
  expect(p + cdSize).toBe(eocd);
  const out: RawEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // Local header must agree with the central directory.
    expect(v.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(v.getUint16(localOffset + 8, true)).toBe(method);
    expect(v.getUint32(localOffset + 14, true)).toBe(crc);
    expect(v.getUint32(localOffset + 18, true)).toBe(compSize);
    expect(v.getUint32(localOffset + 22, true)).toBe(size);
    const lNameLen = v.getUint16(localOffset + 26, true);
    const lExtraLen = v.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    out.push({ name, method, crc, compSize, size, localOffset, payload: bytes.subarray(start, start + compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Deterministic pseudo-random bytes (incompressible). */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24; }
  return out;
}

/** A UV sphere — a mesh whose 3MF XML looks like a real export's. */
function sphere(rings: number, segs: number, r = 40): MeshData {
  const verts: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j < segs; j++) {
      const ph = (j / segs) * Math.PI * 2;
      verts.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
    }
  }
  const tris: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs, c = a + segs, d = b + segs;
      if (i > 0) tris.push(a, b, c);
      if (i < rings - 1) tris.push(b, d, c);
    }
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

const ENTRIES: ZipEntry[] = [
  { name: 'dir/', data: new Uint8Array(0) },
  { name: 'tiny.txt', data: enc('hi') },
  { name: '3D/3dmodel.model', data: enc('<vertex x="1.000000" y="2.000000" z="3.000000" />\n'.repeat(5000)) },
  { name: 'noise.bin', data: noise(4096) },
  { name: 'ünïcode/naïve.json', data: enc(JSON.stringify({ a: Array.from({ length: 500 }, (_, i) => i) })) },
];

afterEach(() => { vi.unstubAllGlobals(); });

describe('buildZipAsync (DEFLATE)', () => {
  it('round-trips through the app reader and node:zlib with matching CRCs', async () => {
    const bytes = await buildZipAsync(ENTRIES);
    const raw = walkZip(bytes);
    expect(raw.map((e) => e.name)).toEqual(ENTRIES.map((e) => e.name));

    const zip = openZip(bytes);
    for (const [i, entry] of ENTRIES.entries()) {
      const r = raw[i];
      expect(r.size).toBe(entry.data.length);
      expect(r.crc).toBe(refCrc32(entry.data));
      // Independent inflate (node:zlib), not the app's DecompressionStream path.
      const inflated = r.method === 8 ? new Uint8Array(inflateRawSync(r.payload)) : r.payload;
      expect(refCrc32(inflated)).toBe(r.crc);
      expect(Buffer.from(inflated).equals(Buffer.from(entry.data))).toBe(true);
      // And the app's own reader (which lists files only, not directories).
      if (entry.name.endsWith('/')) continue;
      const viaReader = await zip.read(zip.find(entry.name)!);
      expect(Buffer.from(viaReader).equals(Buffer.from(entry.data))).toBe(true);
    }
  });

  it('deflates compressible entries and stores tiny, empty and incompressible ones', async () => {
    const raw = walkZip(await buildZipAsync(ENTRIES));
    const byName = Object.fromEntries(raw.map((e) => [e.name, e]));
    expect(byName['dir/'].method).toBe(0);
    expect(byName['tiny.txt'].method).toBe(0);
    expect(byName['noise.bin'].method).toBe(0);
    expect(byName['noise.bin'].compSize).toBe(4096);
    expect(byName['3D/3dmodel.model'].method).toBe(8);
    expect(byName['3D/3dmodel.model'].compSize).toBeLessThan(byName['3D/3dmodel.model'].size / 20);
  });

  it('compress:false is byte-identical to the sync STORE builder', async () => {
    const a = buildZip(ENTRIES);
    const b = await buildZipAsync(ENTRIES, { compress: false });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(walkZip(a).every((e) => e.method === 0)).toBe(true);
  });

  it('falls back to STORE when CompressionStream is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const bytes = await buildZipAsync(ENTRIES);
    expect(Buffer.from(bytes).equals(Buffer.from(buildZip(ENTRIES)))).toBe(true);
  });

  it("falls back to zlib 'deflate' (header/trailer stripped) when 'deflate-raw' is unsupported", async () => {
    const Native = CompressionStream;
    vi.stubGlobal('CompressionStream', class extends Native {
      constructor(format: CompressionFormat) {
        if (format === 'deflate-raw') throw new TypeError('unsupported');
        super(format);
      }
    });
    const bytes = await buildZipAsync(ENTRIES);
    const raw = walkZip(bytes);
    const model = raw.find((e) => e.name === '3D/3dmodel.model')!;
    expect(model.method).toBe(8);
    const zip = openZip(bytes);
    for (const entry of ENTRIES.filter((e) => !e.name.endsWith('/'))) {
      expect(Buffer.from(await zip.read(zip.find(entry.name)!)).equals(Buffer.from(entry.data))).toBe(true);
    }
  });

  it('crc32 matches the reference for known vectors', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const n = noise(10_000, 7);
    expect(crc32(n)).toBe(refCrc32(n));
  });
});

describe('compressed 3MF builders', () => {
  const mesh = sphere(120, 240);

  it('build3MFProjectAsync has the same entries as the sync build, deflated, and re-imports', async () => {
    for (const bambu of [true, false]) {
      const stored = new Uint8Array(await build3MFProject([{ name: 'ball', mesh }], { bambu }).blob.arrayBuffer());
      const built = await build3MFProjectAsync([{ name: 'ball', mesh }], { bambu });
      expect(built.mimeType).toBe('application/vnd.ms-package.3dmanufacturing');
      expect(built.filename).toMatch(/\.3mf$/);
      const deflated = new Uint8Array(await built.blob.arrayBuffer());
      const a = walkZip(stored), b = walkZip(deflated);
      expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
      for (let i = 0; i < a.length; i++) {
        expect(b[i].crc).toBe(a[i].crc);
        expect(b[i].size).toBe(a[i].size);
        const inflated = b[i].method === 8 ? new Uint8Array(inflateRawSync(b[i].payload)) : b[i].payload;
        expect(Buffer.from(inflated).equals(Buffer.from(a[i].payload))).toBe(true);
      }
      const biggest = b.reduce((m, e) => (e.size > m.size ? e : m));
      expect(biggest.method).toBe(8); // the mesh XML
      expect(deflated.length).toBeLessThan(stored.length / 3);
      const r = await parse3MF(deflated);
      expect(r.mesh.numTri).toBe(mesh.numTri);
    }
  });

  it('build3MFAsync matches build3MF after inflating', async () => {
    const stored = walkZip(new Uint8Array(await build3MF(mesh).blob.arrayBuffer()));
    const deflated = walkZip(new Uint8Array(await (await build3MFAsync(mesh)).blob.arrayBuffer()));
    expect(deflated.map((e) => [e.name, e.crc, e.size])).toEqual(stored.map((e) => [e.name, e.crc, e.size]));
    const model = deflated.find((e) => e.name === '3D/3dmodel.model')!;
    expect(model.method).toBe(8);
    expect(model.compSize).toBeLessThan(model.size / 3);
  });
});
