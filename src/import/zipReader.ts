// Minimal ZIP reader — the counterpart of `src/export/zip.ts` (STORE-only
// writer). Reads the central directory, then inflates entries on demand with the
// native `DecompressionStream('deflate-raw')` (all evergreen browsers + Node 18+),
// so the bundle carries no unzip dependency. Supports STORE (0) and DEFLATE (8),
// data-descriptor entries (sizes come from the central directory), and ZIP64
// sizes/offsets — Bambu Studio's miniz writer emits ZIP64 extras on large models.
//
// Pure (no DOM), so it unit-tests in the vitest tier.

export interface ZipFileEntry {
  /** Entry path as stored (forward slashes, no leading slash). */
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: ZipFileEntry[];
  /** Case-insensitive lookup by path; a leading '/' is ignored (3MF part names
   *  are absolute, e.g. `/3D/3dmodel.model`). */
  find(path: string): ZipFileEntry | undefined;
  /** Decompressed bytes of an entry. */
  read(entry: ZipFileEntry): Promise<Uint8Array>;
  /** Decompressed UTF-8 text of an entry. */
  readText(entry: ZipFileEntry): Promise<string>;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** True when `bytes` starts with the ZIP local-file-header magic (`PK\x03\x04`). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/** Parse a ZIP archive's central directory. Throws on a malformed archive. */
export function openZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  if (len < 22) throw new Error('Not a ZIP archive (file too small).');

  // The End Of Central Directory record sits in the last 22..(22+65535) bytes
  // (it may be followed by a variable-length comment). Scan backwards for it.
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).');

  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // ZIP64: the classic fields are saturated and the real values live in the
  // ZIP64 EOCD record, located via the locator immediately before the EOCD.
  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_EOCD_LOCATOR_SIG) {
    const z64 = Number(view.getBigUint64(eocd - 20 + 8, true));
    if (z64 + 56 <= len && view.getUint32(z64, true) === ZIP64_EOCD_SIG) {
      count = Number(view.getBigUint64(z64 + 32, true));
      cdOffset = Number(view.getBigUint64(z64 + 48, true));
    }
  }

  const decoder = new TextDecoder('utf-8');
  const entries: ZipFileEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > len || view.getUint32(p, true) !== CENTRAL_SIG) {
      throw new Error('Corrupt ZIP archive (bad central directory entry).');
    }
    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localHeaderOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 extended-information extra field (id 0x0001): holds, in order, only
    // the fields whose 32-bit slot is saturated.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = view.getUint16(e, true);
      const size = view.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff && q + 8 <= e + 4 + size) { uncompressedSize = Number(view.getBigUint64(q, true)); q += 8; }
        if (compressedSize === 0xffffffff && q + 8 <= e + 4 + size) { compressedSize = Number(view.getBigUint64(q, true)); q += 8; }
        if (localHeaderOffset === 0xffffffff && q + 8 <= e + 4 + size) { localHeaderOffset = Number(view.getBigUint64(q, true)); }
      }
      e += 4 + size;
    }

    if (!name.endsWith('/')) {
      entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  const index = new Map<string, ZipFileEntry>();
  for (const entry of entries) index.set(normalize(entry.name), entry);

  async function read(entry: ZipFileEntry): Promise<Uint8Array> {
    const off = entry.localHeaderOffset;
    if (off + 30 > len || view.getUint32(off, true) !== LOCAL_SIG) {
      throw new Error(`Corrupt ZIP archive (bad local header for ${entry.name}).`);
    }
    const start = off + 30 + view.getUint16(off + 26, true) + view.getUint16(off + 28, true);
    const raw = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRaw(raw);
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
  }

  return {
    entries,
    find: (path: string) => index.get(normalize(path)),
    read,
    readText: async (entry: ZipFileEntry) => decoder.decode(await read(entry)),
  };
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress ZIP data (DecompressionStream is unavailable).');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
