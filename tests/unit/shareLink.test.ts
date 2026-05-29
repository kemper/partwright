// Unit tests for the client-side share-link codec (src/share/shareLink.ts).
// Pure logic, no browser/DOM — encode/decode lean on the native (Compression|
// Decompression)Stream + TextEncoder/atob/btoa, all available in Node 18+.
//
// encode/decode are ASYNC: await them, and use `await expect(...).rejects` for
// failure cases (a sync `.toThrow` would silently pass on a rejected promise).

import { describe, test, expect } from 'vitest';
import {
  bytesToBase64Url,
  base64UrlToBytes,
  isSafeImageDataUrl,
  trimForShare,
  encodeShare,
  decodeShare,
  validateSharePayloadShape,
  ShareDecodeError,
  MAX_DECOMPRESSED_BYTES,
} from '../../src/share/shareLink';
import type { ExportedSession } from '../../src/storage/sessionManager';

// Fail loud if the runtime lacks the streams API — these tests can't run
// without it, and a silent skip would hide a regression.
expect(typeof DecompressionStream).toBe('function');
expect(typeof CompressionStream).toBe('function');

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function makeExported(overrides: Partial<ExportedSession['versions'][0]> = {}, top: Partial<ExportedSession> = {}): ExportedSession {
  return {
    partwright: '1.8',
    session: { name: 'Test design', created: 1000, updated: 2000 },
    parts: [{ name: 'Part 1', order: 0 }],
    versions: [
      {
        index: 1,
        code: 'const { Manifold } = api;\nreturn Manifold.cube([5,5,5], true);',
        label: 'v1',
        geometryData: { status: 'ok', volume: 125, surfaceArea: 150, isManifold: true, componentCount: 1 },
        timestamp: 1500,
        ...overrides,
      },
    ],
    ...top,
  };
}

describe('bytesToBase64Url / base64UrlToBytes', () => {
  test('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 100, 42]);
    const s = bytesToBase64Url(bytes);
    expect(Array.from(base64UrlToBytes(s))).toEqual(Array.from(bytes));
  });

  test('round-trips a 1-byte tail (length % 3 === 1)', () => {
    const bytes = new Uint8Array([7]); // base64 would normally pad with "=="
    const s = bytesToBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(s))).toEqual([7]);
  });

  test('round-trips a 2-byte tail (length % 3 === 2)', () => {
    const bytes = new Uint8Array([7, 200]); // base64 would normally pad with "="
    const s = bytesToBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(s))).toEqual([7, 200]);
  });

  test('output never contains +, /, or =', () => {
    // 0xFB,0xFF would produce "+/" in standard base64.
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xff]);
    const s = bytesToBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
  });

  test('base64UrlToBytes rejects standard-base64 characters', () => {
    expect(() => base64UrlToBytes('ab+c')).toThrow(ShareDecodeError);
    expect(() => base64UrlToBytes('ab/c')).toThrow(ShareDecodeError);
    expect(() => base64UrlToBytes('abc=')).toThrow(ShareDecodeError);
  });
});

describe('isSafeImageDataUrl', () => {
  test('accepts png / jpeg / webp / gif raster data URLs', () => {
    expect(isSafeImageDataUrl(TINY_PNG)).toBe(true);
    expect(isSafeImageDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isSafeImageDataUrl('data:image/webp;base64,UklGRhoAAABXRUJQ')).toBe(true);
    expect(isSafeImageDataUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(true);
  });

  test('is case-insensitive on the scheme and mime', () => {
    expect(isSafeImageDataUrl('DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageDataUrl('Data:Image/Png;Base64,iVBORw0KGgo=')).toBe(true);
  });

  test('rejects svg / text-html / javascript / https / non-string', () => {
    expect(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeImageDataUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageDataUrl('https://evil.example/x.png')).toBe(false);
    expect(isSafeImageDataUrl(undefined)).toBe(false);
    expect(isSafeImageDataUrl(null)).toBe(false);
    expect(isSafeImageDataUrl(12345)).toBe(false);
  });

  test('rejects whitespace and embedded characters', () => {
    expect(isSafeImageDataUrl('data:image/png;base64, iVBORw0KGgo=')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,iVBOR\nw0KGgo=')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,iVBOR,<script>alert(1)</script>')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,abc"def')).toBe(false);
    // Trailing newline must be rejected — a bare `$` (no `m` flag) would match
    // the position just before it and let "…=\n" through.
    expect(isSafeImageDataUrl('data:image/png;base64,iVBORw0KGgo=\n')).toBe(false);
  });

  test('rejects an oversized data URL', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(2_000_000);
    expect(isSafeImageDataUrl(huge)).toBe(false);
  });
});

describe('trimForShare', () => {
  test('strips importedMeshes but keeps stats + colorRegions + thumbnail', () => {
    const exported = makeExported({
      thumbnail: TINY_PNG,
      colorRegions: [{ kind: 'coplanar', seedPoint: [0, 0, 0], color: '#ff0000' } as never],
      importedMeshes: [{ id: 'm1', filename: 'x.stl', format: 'stl', numVert: 3, numTri: 1, numProp: 3, vertProperties: 'AAA', triVerts: 'AAA' }],
    });
    const trimmed = trimForShare(exported);
    expect(trimmed.versions[0].importedMeshes).toBeUndefined();
    expect(trimmed.versions[0].thumbnail).toBe(TINY_PNG);
    expect(trimmed.versions[0].colorRegions).toBeDefined();
    expect(trimmed.versions[0].geometryData).toMatchObject({ volume: 125, isManifold: true });
  });

  test('drops a heavy mesh array inside geometryData but keeps scalar stats', () => {
    const exported = makeExported({
      geometryData: { status: 'ok', volume: 10, vertProperties: new Float32Array(1000), triVerts: [1, 2, 3, 4, 5, 6] },
    });
    const trimmed = trimForShare(exported);
    const geo = trimmed.versions[0].geometryData as Record<string, unknown>;
    expect(geo.vertProperties).toBeUndefined();
    expect(geo.triVerts).toBeUndefined();
    expect(geo.volume).toBe(10);
  });

  test('does not mutate the input', () => {
    const exported = makeExported({ importedMeshes: [{ id: 'm1', filename: 'x.stl', format: 'stl', numVert: 0, numTri: 0, numProp: 3, vertProperties: '', triVerts: '' }] });
    trimForShare(exported);
    expect(exported.versions[0].importedMeshes).toBeDefined();
  });
});

describe('encodeShare / decodeShare round-trip', () => {
  test('round-trips a plain payload', async () => {
    const x = makeExported();
    const decoded = await decodeShare(await encodeShare(x));
    expect(validateSharePayloadShape(decoded)).toEqual(trimForShare(x));
  });

  test('round-trips with colorRegions', async () => {
    const x = makeExported({ colorRegions: [{ kind: 'coplanar', seedPoint: [1, 2, 3], color: '#00ff00' } as never] });
    const decoded = await decodeShare(await encodeShare(x));
    expect(validateSharePayloadShape(decoded)).toEqual(trimForShare(x));
  });

  test('round-trips with annotations', async () => {
    const x = makeExported({ annotations: [{ kind: 'stroke', id: 'a1', points: [[0, 0, 0]], color: '#fff', width: 2 } as never] });
    const decoded = await decodeShare(await encodeShare(x));
    expect(validateSharePayloadShape(decoded)).toEqual(trimForShare(x));
  });

  test('round-trips with a thumbnail', async () => {
    const x = makeExported({ thumbnail: TINY_PNG });
    const decoded = await decodeShare(await encodeShare(x));
    const validated = validateSharePayloadShape(decoded);
    expect(validated.versions[0].thumbnail).toBe(TINY_PNG);
    expect(validated).toEqual(trimForShare(x));
  });

  test('strips importedMeshes through the round-trip (trim runs in encode)', async () => {
    const x = makeExported({ importedMeshes: [{ id: 'm', filename: 'f.stl', format: 'stl', numVert: 1, numTri: 1, numProp: 3, vertProperties: 'QQ', triVerts: 'QQ' }] });
    const decoded = await decodeShare(await encodeShare(x)) as ExportedSession;
    expect(decoded.versions[0].importedMeshes).toBeUndefined();
  });

  test('decodeShare rejects garbage base64url (not gzip) with the generic error', async () => {
    // Valid base64url characters but not a gzip stream.
    await expect(decodeShare('bm90Z3ppcGRhdGE')).rejects.toThrow(ShareDecodeError);
    await expect(decodeShare('bm90Z3ppcGRhdGE')).rejects.toThrow(/not valid gzip/);
  });

  test('decodeShare rejects non-url-safe input', async () => {
    await expect(decodeShare('++not+url+safe++')).rejects.toThrow(ShareDecodeError);
  });
});

describe('decodeShare zip-bomb defense', () => {
  test('rejects a payload that decompresses past the cap with the DISTINCT cap error, and rejects fast', async () => {
    // Build a real gzip of a multi-MB zero-filled buffer (compresses tiny,
    // expands well over MAX_DECOMPRESSED_BYTES).
    const zeros = new Uint8Array(MAX_DECOMPRESSED_BYTES + 2_000_000); // ~10 MB of zeros
    const gz = new Uint8Array(
      await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    );
    const encoded = bytesToBase64Url(gz);
    // Encoded gzip of zeros is small, proving the bomb shape.
    expect(encoded.length).toBeLessThan(200_000);

    const start = Date.now();
    await expect(decodeShare(encoded)).rejects.toThrow(/exceeds.*size cap/i);
    // Bounded: the bail happens chunk-by-chunk, not after buffering ~10 MB.
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('the cap error message is distinct from the not-gzip error message', async () => {
    let capMsg = '';
    let garbageMsg = '';
    const zeros = new Uint8Array(MAX_DECOMPRESSED_BYTES + 2_000_000);
    const gz = new Uint8Array(
      await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    );
    try { await decodeShare(bytesToBase64Url(gz)); } catch (e) { capMsg = (e as Error).message; }
    try { await decodeShare('bm90Z3ppcGRhdGE'); } catch (e) { garbageMsg = (e as Error).message; }
    expect(capMsg).not.toBe(garbageMsg);
    expect(capMsg).toMatch(/exceeds/i);
    expect(garbageMsg).toMatch(/gzip/i);
  });
});

describe('validateSharePayloadShape (sync)', () => {
  test('accepts a well-formed payload', () => {
    expect(() => validateSharePayloadShape(makeExported())).not.toThrow();
  });

  test('throws on a non-object', () => {
    expect(() => validateSharePayloadShape(null)).toThrow(ShareDecodeError);
    expect(() => validateSharePayloadShape('a string')).toThrow(ShareDecodeError);
    expect(() => validateSharePayloadShape(42)).toThrow(ShareDecodeError);
    expect(() => validateSharePayloadShape([])).toThrow(ShareDecodeError);
  });

  test('throws when session is missing', () => {
    expect(() => validateSharePayloadShape({ partwright: '1.8', versions: [{ index: 1, code: 'x', label: 'v', geometryData: null, timestamp: 0 }] })).toThrow(/missing "session"/);
  });

  test('throws on an empty or missing versions array', () => {
    expect(() => validateSharePayloadShape({ partwright: '1.8', session: { name: 'x', created: 0, updated: 0 }, versions: [] })).toThrow(/no versions/);
    expect(() => validateSharePayloadShape({ partwright: '1.8', session: { name: 'x', created: 0, updated: 0 } })).toThrow(/no versions/);
  });

  test('throws on oversized code', () => {
    const big = makeExported({ code: 'x'.repeat(600 * 1024) });
    expect(() => validateSharePayloadShape(big)).toThrow(/code exceeds/);
  });

  test('throws on oversized label', () => {
    const big = makeExported({ label: 'L'.repeat(300) });
    expect(() => validateSharePayloadShape(big)).toThrow(/label exceeds/);
  });

  test('throws on oversized session name', () => {
    const big = makeExported({}, { session: { name: 'N'.repeat(300), created: 0, updated: 0 } });
    expect(() => validateSharePayloadShape(big)).toThrow(/name exceeds/);
  });

  test('drops an unsafe thumbnail but keeps the rest of the payload', () => {
    const payload = makeExported({ thumbnail: 'data:text/html;base64,PHNjcmlwdD4=' });
    const validated = validateSharePayloadShape(payload);
    expect(validated.versions[0].thumbnail).toBeUndefined();
    expect(validated.versions[0].code).toBe(payload.versions[0].code);
    expect(validated.session.name).toBe('Test design');
  });

  test('keeps a safe thumbnail', () => {
    const payload = makeExported({ thumbnail: TINY_PNG });
    const validated = validateSharePayloadShape(payload);
    expect(validated.versions[0].thumbnail).toBe(TINY_PNG);
  });
});
