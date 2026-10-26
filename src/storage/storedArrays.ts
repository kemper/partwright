// Big typed arrays in IndexedDB records, stored as Blobs.
//
// `put()` structured-clones its value synchronously on the main thread: a
// version holding a 3.7M-triangle import (~67 MB of vertProperties/triVerts)
// blocked the UI ~0.55 s per save, and reading it back blocked another
// ~0.18 s. A Blob is cloned by reference: making one copies the bytes once
// (~0.07 s for the same mesh) and the database writes and reads it out of line,
// so neither the put nor the get blocks on the payload.
//
// `packStoredArrays` swaps every typed array of at least `minBytes` for a
// marker holding a Blob; `unpackStoredArrays` turns the markers back into the
// same typed arrays. Unpacking leaves values without markers alone, so records
// written before this existed (and small arrays) read back unchanged.

const MARKER = '__pwStoredArray';

const CTORS = {
  Float32Array, Float64Array,
  Int8Array, Int16Array, Int32Array,
  Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
} as const;
type CtorName = keyof typeof CTORS;

interface StoredArray { [MARKER]: 1; type: CtorName; blob: Blob }

/** Nesting depth the walk follows: versions are shallow (version → imports →
 *  parts → arrays); a cap keeps a pathological record from recursing deep. */
const MAX_DEPTH = 12;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function ctorName(v: unknown): CtorName | null {
  if (!ArrayBuffer.isView(v) || v instanceof DataView) return null;
  const name = v.constructor.name;
  return name in CTORS ? name as CtorName : null;
}

function isStoredArray(v: unknown): v is StoredArray {
  return isPlainObject(v) && v[MARKER] === 1 && typeof v.type === 'string' && v.type in CTORS && v.blob instanceof Blob;
}

/** `value` with each typed array of at least `minBytes` replaced by a Blob
 *  marker. Containers on the path to a replaced array are shallow-copied, so
 *  the caller's objects are never modified; unchanged branches are shared. */
export function packStoredArrays<T>(value: T, minBytes: number): T {
  return pack(value, minBytes, 0) as T;
}

function pack(v: unknown, minBytes: number, depth: number): unknown {
  const name = ctorName(v);
  if (name) {
    const arr = v as ArrayBufferView;
    if (arr.byteLength < minBytes) return v;
    const marker: StoredArray = { [MARKER]: 1, type: name, blob: new Blob([arr as BlobPart]) };
    return marker;
  }
  if (depth >= MAX_DEPTH) return v;
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const item = v[i];
      if (item === null || typeof item !== 'object') continue;
      const packed = pack(item, minBytes, depth + 1);
      if (packed !== item) (out ??= v.slice())[i] = packed;
    }
    return out ?? v;
  }
  if (isPlainObject(v)) {
    let out: Record<string, unknown> | null = null;
    for (const key of Object.keys(v)) {
      const item = v[key];
      if (item === null || typeof item !== 'object') continue;
      const packed = pack(item, minBytes, depth + 1);
      if (packed !== item) (out ??= { ...v })[key] = packed;
    }
    return out ?? v;
  }
  return v;
}

/** Restore the typed arrays `packStoredArrays` replaced, in place (`value`
 *  is a fresh record from the database, owned by the caller). Resolves to
 *  `value` itself, or to the restored array when `value` is a marker. */
export async function unpackStoredArrays<T>(value: T): Promise<T> {
  const pending: Promise<void>[] = [];
  const root = { v: value as unknown };
  collect(root, 'v', 0, pending);
  if (pending.length > 0) await Promise.all(pending);
  return root.v as T;
}

function collect(holder: Record<string, unknown> | unknown[], key: string | number, depth: number, pending: Promise<void>[]): void {
  const v = (holder as Record<string | number, unknown>)[key];
  if (v === null || typeof v !== 'object') return;
  if (isStoredArray(v)) {
    const Ctor = CTORS[v.type];
    pending.push(v.blob.arrayBuffer().then(buf => {
      (holder as Record<string | number, unknown>)[key] = new Ctor(buf);
    }));
    return;
  }
  if (depth >= MAX_DEPTH) return;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const item = v[i];
      if (item !== null && typeof item === 'object') collect(v, i, depth + 1, pending);
    }
  } else if (isPlainObject(v)) {
    for (const k of Object.keys(v)) collect(v, k, depth + 1, pending);
  }
}
