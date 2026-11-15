// Minimal ZIP builder for 3MF, OBJ+MTL and STL bundles.
//
// Two entry points:
//   - `buildZip`      — synchronous, STORE only (no compression). Kept for the
//                       sync callers and as the fallback.
//   - `buildZipAsync` — DEFLATE (method 8) via the native
//                       `CompressionStream('deflate-raw')` (evergreen browsers,
//                       Node 18+), so the bundle carries no zlib dependency. An
//                       entry falls back to STORE when compression is unavailable,
//                       fails, or wouldn't make it smaller.
//
// No ZIP64: entries and the archive must stay under 4 GiB (far beyond any mesh
// the app can build). Pure (no DOM), so it unit-tests in the vitest tier.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export interface BuildZipOptions {
  /** DEFLATE entries (default true). false = STORE everything. */
  compress?: boolean;
}

/** One entry as it is written: method + the (possibly compressed) payload. */
interface PackedEntry {
  nameBytes: Uint8Array;
  method: 0 | 8;
  crc: number;
  uncompressedSize: number;
  payload: Uint8Array;
}

/** Entries below this size are stored as-is: deflate can't win on a few bytes
 *  and the empty directory entries must stay STORE. */
const MIN_DEFLATE_BYTES = 64;

export function buildZip(entries: ZipEntry[]): Uint8Array {
  return assembleZip(entries.map((e) => storeEntry(e)));
}

export async function buildZipAsync(entries: ZipEntry[], opts: BuildZipOptions = {}): Promise<Uint8Array> {
  const compress = opts.compress ?? true;
  const packed: PackedEntry[] = [];
  for (const entry of entries) {
    const deflated = compress && entry.data.length >= MIN_DEFLATE_BYTES ? await deflateRaw(entry.data) : null;
    packed.push(deflated && deflated.length < entry.data.length
      ? { nameBytes: encodeName(entry.name), method: 8, crc: crc32(entry.data), uncompressedSize: entry.data.length, payload: deflated }
      : storeEntry(entry));
  }
  return assembleZip(packed);
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function storeEntry(entry: ZipEntry): PackedEntry {
  return { nameBytes: encodeName(entry.name), method: 0, crc: crc32(entry.data), uncompressedSize: entry.data.length, payload: entry.data };
}

/** Raw DEFLATE (RFC 1951) of `data`, or null when the runtime can't compress.
 *  Prefers `'deflate-raw'`; a runtime that only has `'deflate'` (zlib, RFC 1950)
 *  gets its 2-byte header and 4-byte Adler-32 trailer stripped. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await runCompression('deflate-raw', data);
  } catch { /* format unsupported — try zlib-wrapped */ }
  try {
    const z = await runCompression('deflate', data);
    // zlib header: CMF (method 8) + FLG with FDICT clear; trailer: Adler-32.
    if (z.length < 6 || (z[0] & 0x0f) !== 8 || (z[1] & 0x20) !== 0) return null;
    return z.subarray(2, z.length - 4);
  } catch {
    return null;
  }
}

async function runCompression(format: CompressionFormat, data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function assembleZip(packed: PackedEntry[]): Uint8Array {
  let localSize = 0;
  let centralSize = 0;
  for (const p of packed) {
    localSize += 30 + p.nameBytes.length + p.payload.length;
    centralSize += 46 + p.nameBytes.length;
  }
  if (localSize + centralSize + 22 > 0xffffffff || packed.length > 0xffff) {
    throw new Error('ZIP too large (over 4 GiB or 65535 entries; ZIP64 is not supported).');
  }

  const result = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(result.buffer);
  let pos = 0;
  const offsets: number[] = [];

  for (const p of packed) {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);         // local file header signature
    view.setUint16(pos + 4, 20, true);              // version needed (2.0: deflate)
    view.setUint16(pos + 6, 0, true);               // flags
    view.setUint16(pos + 8, p.method, true);        // compression: 0 STORE / 8 DEFLATE
    view.setUint16(pos + 10, 0, true);              // mod time
    view.setUint16(pos + 12, 0, true);              // mod date
    view.setUint32(pos + 14, p.crc, true);          // crc32 of the uncompressed data
    view.setUint32(pos + 18, p.payload.length, true);   // compressed size
    view.setUint32(pos + 22, p.uncompressedSize, true); // uncompressed size
    view.setUint16(pos + 26, p.nameBytes.length, true); // name length
    view.setUint16(pos + 28, 0, true);              // extra length
    result.set(p.nameBytes, pos + 30);
    result.set(p.payload, pos + 30 + p.nameBytes.length);
    pos += 30 + p.nameBytes.length + p.payload.length;
  }

  const centralDirOffset = pos;
  packed.forEach((p, i) => {
    view.setUint32(pos, 0x02014b50, true);         // central directory signature
    view.setUint16(pos + 4, 20, true);              // version made by
    view.setUint16(pos + 6, 20, true);              // version needed
    view.setUint16(pos + 8, 0, true);               // flags
    view.setUint16(pos + 10, p.method, true);       // compression
    view.setUint16(pos + 12, 0, true);              // mod time
    view.setUint16(pos + 14, 0, true);              // mod date
    view.setUint32(pos + 16, p.crc, true);          // crc32
    view.setUint32(pos + 20, p.payload.length, true);   // compressed size
    view.setUint32(pos + 24, p.uncompressedSize, true); // uncompressed size
    view.setUint16(pos + 28, p.nameBytes.length, true); // name length
    view.setUint16(pos + 30, 0, true);              // extra length
    view.setUint16(pos + 32, 0, true);              // comment length
    view.setUint16(pos + 34, 0, true);              // disk number
    view.setUint16(pos + 36, 0, true);              // internal attrs
    view.setUint32(pos + 38, 0, true);              // external attrs
    view.setUint32(pos + 42, offsets[i], true);     // local header offset
    result.set(p.nameBytes, pos + 46);
    pos += 46 + p.nameBytes.length;
  });

  // End of central directory (22 bytes)
  view.setUint32(pos, 0x06054b50, true);           // signature
  view.setUint16(pos + 4, 0, true);                 // disk number
  view.setUint16(pos + 6, 0, true);                 // central dir disk
  view.setUint16(pos + 8, packed.length, true);     // entries on disk
  view.setUint16(pos + 10, packed.length, true);    // total entries
  view.setUint32(pos + 12, centralSize, true);      // central dir size
  view.setUint32(pos + 16, centralDirOffset, true); // central dir offset
  view.setUint16(pos + 20, 0, true);                // comment length

  return result;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3, the ZIP polynomial), table-driven. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  const t = crcTable;
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
