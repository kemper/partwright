import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerImport,
  registerImportSnapshot,
  listImports,
  clearImports,
} from '../../src/import/importInbox';

describe('importInbox', () => {
  beforeEach(() => clearImports());

  it('registerImport keeps the live blob reference', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    registerImport(blob, 'a.png', 'IMAGE');
    expect(listImports()[0].blob).toBe(blob);
  });

  it('registerImportSnapshot stores an independent in-memory copy', async () => {
    // A blob whose bytes we can verify survive snapshotting.
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const src = new Blob([bytes], { type: 'image/png' });
    await registerImportSnapshot(src, 'b.png', 'IMAGE', { importer: 'voxel', options: {} }, 'data:thumb');
    const entry = listImports()[0];
    // Distinct Blob object (decoupled from the original file-backed reference)…
    expect(entry.blob).not.toBe(src);
    // …with the same bytes, type, metadata, and thumbnail preserved.
    expect(new Uint8Array(await entry.blob.arrayBuffer())).toEqual(bytes);
    expect(entry.blob.type).toBe('image/png');
    expect(entry.thumbnail).toBe('data:thumb');
    expect(entry.metadata).toEqual({ importer: 'voxel', options: {} });
  });

  it('snapshot falls back to the live blob if reading fails', async () => {
    // A blob-like whose arrayBuffer rejects (simulating an unreadable OS file).
    const broken = {
      type: 'image/png',
      size: 3,
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    } as unknown as Blob;
    await registerImportSnapshot(broken, 'c.png', 'IMAGE');
    // Still registered (a stale entry beats none) — falls back to the reference.
    expect(listImports()[0].blob).toBe(broken);
  });

  it('dedupes on (filename, metadata), bubbling the match to the top', async () => {
    await registerImportSnapshot(new Blob([new Uint8Array([1])]), 'd.png', 'IMAGE', { importer: 'voxel', options: { maxSize: 64 } });
    await registerImportSnapshot(new Blob([new Uint8Array([2])]), 'e.png', 'IMAGE', { importer: 'voxel', options: { maxSize: 64 } });
    // Same filename + metadata as the first → updates in place, no duplicate.
    await registerImportSnapshot(new Blob([new Uint8Array([3])]), 'd.png', 'IMAGE', { importer: 'voxel', options: { maxSize: 64 } });
    const list = listImports();
    expect(list.filter(e => e.filename === 'd.png')).toHaveLength(1);
    expect(list[0].filename).toBe('d.png'); // bubbled to top
  });
});
