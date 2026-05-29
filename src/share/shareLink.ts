// Pure, DOM-free, dependency-free codec for client-side shareable session links.
//
// A share link encodes ONE committed design version into the URL hash
// (`/editor#share=<base64url>`) so the design never reaches a server. The
// payload is a single-version {@link ExportedSession} (the same type file
// import/export already use) gzipped via the native `CompressionStream` and
// base64url-encoded. Decoding reverses it. Both directions cap the decompressed
// size so a hostile link can't OOM the tab (zip-bomb defense).
//
// This module is the security-critical half of the feature: the viewer decodes
// UNTRUSTED input, so every validator here is hardened and the module stays
// import-free for isolated vitest coverage (mirrors src/ai/patch.ts).
//
// See `.plans/share-links.md` for the design and the documented PHASE 2
// (durable short-link backend / live-spin-without-fork) follow-ups.

import type { ExportedSession } from '../storage/sessionManager';

/** Hard cap on the gunzipped payload size. Decoding aborts the moment the
 *  running total of decompressed bytes exceeds this, before buffering the rest,
 *  so a small gzip that expands to gigabytes can't exhaust memory. */
export const MAX_DECOMPRESSED_BYTES = 8_000_000;

/** Per-string sanity caps applied by {@link validateSharePayloadShape}. A
 *  shared link is untrusted, so reject absurd field sizes outright rather than
 *  letting them flow into the editor / DOM. */
const MAX_CODE_CHARS = 512 * 1024;
const MAX_LABEL_CHARS = 256;
const MAX_NAME_CHARS = 256;

/** Cap on a thumbnail data URL we'll accept as "safe". A few hundred KB covers
 *  a generous PNG/JPEG/WebP preview; anything larger is dropped. */
const MAX_IMAGE_DATA_URL_CHARS = 1_500_000;

/** Thrown for any decode/validation failure on untrusted share input. Callers
 *  treat every instance as "this shared link is invalid or corrupted" and fall
 *  back to a normal editable editor. */
export class ShareDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

/** Thrown by {@link encodeShare} when the browser lacks `CompressionStream`.
 *  Distinct from {@link ShareDecodeError} so the share-action path can surface a
 *  "needs a newer browser" message instead of "corrupted". */
export class ShareUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareUnsupportedError';
  }
}

// === base64url ===

/** Encode bytes as URL-safe base64 (`-_` alphabet, no `=` padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // avoid the arg-count limit on String.fromCharCode.apply
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode URL-safe base64 back into bytes. Rejects input containing the
 *  standard-base64 characters (`+`, `/`, `=`) — those never appear in our
 *  URL-safe output, so their presence means the string was tampered with or is
 *  the wrong encoding. */
export function base64UrlToBytes(s: string): Uint8Array {
  if (typeof s !== 'string') throw new ShareDecodeError('share: input is not a string');
  if (/[+/=]/.test(s)) throw new ShareDecodeError('share: input contains non-url-safe base64 characters');
  // Restore the standard alphabet + padding for atob.
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) throw new ShareDecodeError('share: invalid base64url length');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareDecodeError('share: not valid base64');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// === thumbnail safety ===

/** Anchored, case-insensitive allow-list for a thumbnail data URL: only raster
 *  PNG/JPEG/WebP/GIF base64 payloads. Rejects svg/text/html/javascript schemes,
 *  https URLs, whitespace, embedded characters (e.g. `,<script>`), and anything
 *  over the length cap. Used both before assigning `img.src` in the viewer and
 *  to drop an unsafe thumbnail from an imported payload. */
export function isSafeImageDataUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (s.length > MAX_IMAGE_DATA_URL_CHARS) return false;
  // Anchored: scheme + raster mime + base64 marker + a pure base64 body to end.
  // No whitespace or `<`/`>`/`"` can appear because the body class excludes them.
  // `(?![\s\S])` (true end-of-string) rather than `$`, which without the `m`
  // flag would also match just before a trailing newline — so "…AAAA\n" is
  // rejected, keeping the validator exactly as strict as its doc comment.
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}(?![\s\S])/i.test(s);
}

// === trim ===

/** Drop the heavy, share-irrelevant parts of an exported session: the
 *  base64-encoded imported-mesh buffers (STL geometry) on each version, and any
 *  bulky mesh array smuggled inside `geometryData` (e.g. raw vertex/triangle
 *  arrays) — while KEEPING the stats (volume/surfaceArea/boundingBox/
 *  componentCount/isManifold) and `colorRegions` that the preview needs. Does
 *  not mutate the input. */
export function trimForShare(exported: ExportedSession): ExportedSession {
  const versions = Array.isArray(exported.versions) ? exported.versions : [];
  return {
    ...exported,
    versions: versions.map(v => {
      const { importedMeshes: _drop, geometryData, ...rest } = v;
      return { ...rest, geometryData: trimGeometryData(geometryData) };
    }),
  };
}

/** Strip heavy mesh arrays from a geometryData blob while keeping the scalar
 *  stats and `colorRegions`. The renderer never reads raw mesh arrays out of
 *  geometryData (they live on the Version's `importedMeshes`), so dropping them
 *  here is lossless for the preview. */
function trimGeometryData(
  geometryData: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!geometryData || typeof geometryData !== 'object') return geometryData ?? null;
  const HEAVY_KEYS = ['mesh', 'vertProperties', 'triVerts', 'vertices', 'triangles', 'faces', 'normals'];
  let touched = false;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(geometryData)) {
    if (HEAVY_KEYS.includes(k) && (ArrayBuffer.isView(val) || Array.isArray(val))) {
      touched = true;
      continue;
    }
    out[k] = val;
  }
  return touched ? out : geometryData;
}

// === encode / decode ===

/** Read a ReadableStream of Uint8Array chunks fully into a single Uint8Array,
 *  aborting (and throwing {@link ShareDecodeError}) the moment the running byte
 *  total exceeds {@link MAX_DECOMPRESSED_BYTES}. The early bail is what makes
 *  decode safe against a zip bomb — we never buffer the full output first. */
async function readAllBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        await reader.cancel();
        throw new ShareDecodeError('share: decompressed payload exceeds size cap');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Trim → JSON → gzip → base64url. Throws {@link ShareUnsupportedError} when the
 *  browser has no `CompressionStream` so the caller can disable the feature
 *  gracefully rather than crash. */
export async function encodeShare(exported: ExportedSession): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    throw new ShareUnsupportedError('share: CompressionStream is not available in this browser');
  }
  const trimmed = trimForShare(exported);
  const json = JSON.stringify(trimmed);
  const input = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  // See decodeShare: keep writer-side promises from floating as unhandled
  // rejections if the stream is torn down early.
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const gzipped = await readAllBounded(cs.readable);
  return bytesToBase64Url(gzipped);
}

/** base64url → gunzip (bounded, chunk-by-chunk) → TextDecoder → JSON.parse.
 *  Throws {@link ShareDecodeError} on any failure. The distinct "exceeds size
 *  cap" message (from {@link readAllBounded}) lets callers/tests tell a zip bomb
 *  apart from plain non-gzip/JSON garbage. Returns the parsed value as `unknown`
 *  — run it through {@link validateSharePayloadShape} (and the app's
 *  brand/schema validator) before trusting it. */
export async function decodeShare(encoded: string): Promise<unknown> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ShareDecodeError('share: DecompressionStream is not available in this browser');
  }
  const bytes = base64UrlToBytes(encoded);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // Swallow writer-side rejections: when the input isn't valid gzip the writable
  // half rejects too, and an unhandled rejection would crash the test runner /
  // surface a console error. The real failure is read off the readable side
  // below (readAllBounded), so the canonical error message comes from there.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  let raw: Uint8Array;
  try {
    raw = await readAllBounded(ds.readable);
  } catch (e) {
    // Preserve a deliberate "exceeds size cap" ShareDecodeError; remap any other
    // failure (e.g. malformed gzip stream) to the generic decode error.
    if (e instanceof ShareDecodeError) throw e;
    throw new ShareDecodeError('share: not valid gzip data');
  }
  let json: string;
  try {
    json = new TextDecoder().decode(raw);
  } catch {
    throw new ShareDecodeError('share: payload is not valid UTF-8');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new ShareDecodeError('share: payload is not valid JSON');
  }
}

// === structural + security validation ===

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function assertStringCap(value: unknown, max: number, what: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new ShareDecodeError(`share: ${what} must be a string`);
  if (value.length > max) throw new ShareDecodeError(`share: ${what} exceeds the size cap`);
}

/** Structural + security validator for a decoded share payload. Asserts the
 *  object has a `session` object and a non-empty `versions` array, enforces
 *  per-string caps (code / label / session name), and drops an unsafe
 *  `versions[0].thumbnail` (keeping the rest of the payload). Throws
 *  {@link ShareDecodeError} on any structural violation. Does NOT check the
 *  `partwright`/`mainifold` brand or schema version — that's validated
 *  separately by the app's `validateSessionPayload`. Returns the same object
 *  (possibly with an unsafe thumbnail removed) typed as {@link ExportedSession}. */
export function validateSharePayloadShape(raw: unknown): ExportedSession {
  if (!isObject(raw)) throw new ShareDecodeError('share: payload is not an object');
  if (!isObject(raw.session)) throw new ShareDecodeError('share: payload is missing "session"');
  if (!Array.isArray(raw.versions) || raw.versions.length === 0) {
    throw new ShareDecodeError('share: payload has no versions');
  }

  assertStringCap(raw.session.name, MAX_NAME_CHARS, 'session.name');

  for (const v of raw.versions) {
    if (!isObject(v)) throw new ShareDecodeError('share: version entry is not an object');
    assertStringCap(v.code, MAX_CODE_CHARS, 'version code');
    assertStringCap(v.label, MAX_LABEL_CHARS, 'version label');
  }

  // Drop an unsafe leading thumbnail rather than rejecting the whole payload —
  // the rest of the design is still safe to preview, just without the image.
  const first = raw.versions[0] as Record<string, unknown>;
  if ('thumbnail' in first && !isSafeImageDataUrl(first.thumbnail)) {
    delete first.thumbnail;
  }

  return raw as unknown as ExportedSession;
}
