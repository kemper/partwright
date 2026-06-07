// Recent-imports inbox: a newest-first ring buffer of the last N files the user
// imported. Mirrors the Recent Exports inbox so the toolbar's Import dropdown
// can offer one-click re-import. Holds the underlying Blob so a re-import does
// not require the user to re-pick the file from disk.
//
// The buffer lives in memory (so reads stay synchronous) but is mirrored to
// IndexedDB on every mutation and rehydrated on boot, so the Recent Imports
// list survives a page refresh. Persistence is best-effort: if IndexedDB is
// unavailable the in-memory list still works for the session.

import { applyInboxMutation, clearInboxStore, getInboxRecords } from '../storage/db';
import { reconcileInbox } from '../storage/inboxBuffer';

const STORE = 'importInbox';
const MAX_ENTRIES = 10;

export type ImportSource = 'JSON' | 'JS' | 'SCAD' | 'STL' | 'STEP' | 'IMAGE' | 'VOX' | 'SVG';

export interface ImportInboxEntry {
  id: string;
  blob: Blob;
  filename: string;
  source: ImportSource;
  sizeBytes: number;
  timestamp: number;
  /** Source-specific settings used at create time (e.g. ReliefOptions for an
   *  IMAGE/SVG). Re-clicking the entry pre-loads these into the wizard so the
   *  user can tweak from there; the dedupe key is (filename, settings) so a
   *  Create with unchanged settings doesn't pile up a duplicate entry.
   *
   *  Image-based imports tag this as `{ importer, options }` (see
   *  `ImportMetadata`) so a re-import reopens the right wizard — voxel imports
   *  return to the voxel modal, relief imports to the Relief Studio. */
  metadata?: unknown;
  /** Small data-URL thumbnail of the source (image / SVG), shown beside the
   *  entry in the Recent Imports list. Optional — code/mesh imports omit it. */
  thumbnail?: string;
  /** Companion files (SCAD only): path → content map captured at import time
   *  so a re-import from history restores the same companion set without
   *  requiring the user to re-upload them. */
  companions?: Record<string, string>;
}

/** Discriminated metadata for image-based imports, so a re-import knows which
 *  importer produced the entry and what settings to restore. */
export interface ImportMetadata {
  importer: 'relief' | 'voxel';
  /** ReliefOptions or ImageToVoxelOptions depending on `importer`. */
  options: unknown;
}

const entries: ImportInboxEntry[] = [];
const listeners = new Set<() => void>();

let nextSeq = 1;

function notify() {
  for (const fn of listeners) fn();
}

function importKey(filename: string, metadata?: unknown): string {
  let metaPart = '';
  if (metadata !== undefined) {
    try { metaPart = JSON.stringify(metadata); } catch { metaPart = ''; }
  }
  return `${filename}::${metaPart}`;
}

/** Add an entry to the inbox. Newest entries are at index 0. When an entry
 *  with the same (filename, metadata) key already exists, it's bubbled to the
 *  top with a fresh timestamp instead of duplicated — re-importing the same
 *  image with the same tweaks should leave the recent list tidy. */
export function registerImport(blob: Blob, filename: string, source: ImportSource, metadata?: unknown, thumbnail?: string, companions?: Record<string, string>): ImportInboxEntry {
  const key = importKey(filename, metadata);
  const evicted: string[] = [];
  const existingIdx = entries.findIndex(e => importKey(e.filename, e.metadata) === key);
  if (existingIdx >= 0) evicted.push(entries.splice(existingIdx, 1)[0].id);
  const entry: ImportInboxEntry = {
    id: `imp_${Date.now().toString(36)}_${nextSeq++}`,
    blob,
    filename,
    source,
    sizeBytes: blob.size,
    timestamp: Date.now(),
    metadata,
    thumbnail,
    companions: companions && Object.keys(companions).length > 0 ? companions : undefined,
  };
  entries.unshift(entry);
  while (entries.length > MAX_ENTRIES) {
    const popped = entries.pop();
    if (popped) evicted.push(popped.id);
  }
  notify();
  // Mirror to IndexedDB: drop the deduped/overflowed ids, persist the new entry.
  void applyInboxMutation(STORE, entry, evicted).catch(err => console.debug('importInbox persist failed', err));
  return entry;
}

/** Snapshot of the inbox, newest first. */
export function listImports(): ImportInboxEntry[] {
  return entries.slice();
}

/** Like {@link registerImport}, but first copies the blob's bytes into an
 *  in-memory Blob. A File picked from an `<input>` (or dropped) is backed by
 *  the OS file and read lazily; by the time the user re-imports it from the
 *  Recent list the underlying file may have moved, been renamed, or had its
 *  reference dropped by the browser, so reading it fails — `createImageBitmap`
 *  reports this as "the source image could not be decoded", and STL/JSON
 *  re-imports would hit the same read error. Materializing the bytes at import
 *  time decouples the entry from the original file so re-import always works. */
export async function registerImportSnapshot(blob: Blob, filename: string, source: ImportSource, metadata?: unknown, thumbnail?: string, companions?: Record<string, string>): Promise<ImportInboxEntry> {
  let stable = blob;
  try {
    const buf = await blob.arrayBuffer();
    stable = new Blob([buf], { type: blob.type });
  } catch {
    // Reading already failed (e.g. the file is gone) — fall back to the live
    // reference; nothing more we can do, and a stale entry beats none.
  }
  return registerImport(stable, filename, source, metadata, thumbnail, companions);
}

/** Look up a single entry by id. */
/** Drop everything from the inbox. */
export function clearImports(): void {
  if (entries.length === 0) return;
  entries.length = 0;
  notify();
  void clearInboxStore(STORE).catch(err => console.debug('importInbox clear failed', err));
}

/** Rehydrate the in-memory buffer from IndexedDB on boot so the Recent Imports
 *  list survives a refresh. Safe to call once at startup; merges with anything
 *  already registered this session and reconciles storage back to the cap. */
export async function hydrateImportInbox(): Promise<void> {
  let persisted: ImportInboxEntry[];
  try {
    persisted = await getInboxRecords<ImportInboxEntry>(STORE);
  } catch (err) {
    console.debug('importInbox hydrate failed', err);
    return;
  }
  if (persisted.length === 0) return;
  const { merged, staleIds } = reconcileInbox(entries, persisted, MAX_ENTRIES);
  entries.length = 0;
  entries.push(...merged);
  notify();
  if (staleIds.length > 0) {
    void applyInboxMutation(STORE, null, staleIds).catch(err => console.debug('importInbox reconcile failed', err));
  }
}

/** Subscribe to inbox changes. Returns an unsubscribe fn. */
export function onImportInboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Source label for an import based on filename — used by the inbox + UI. */
export function classifyImportSource(filename: string): ImportSource | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'JSON';
  if (lower.endsWith('.scad')) return 'SCAD';
  if (lower.endsWith('.js')) return 'JS';
  if (lower.endsWith('.stl')) return 'STL';
  if (lower.endsWith('.step') || lower.endsWith('.stp')) return 'STEP';
  if (lower.endsWith('.vox')) return 'VOX';
  if (lower.endsWith('.svg')) return 'SVG';
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(lower)) return 'IMAGE';
  return null;
}
