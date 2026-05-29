// Recent-imports inbox: an in-memory ring buffer of the last N files the user
// imported. Mirrors the Recent Exports inbox so the toolbar's Import dropdown
// can offer one-click re-import. Holds the underlying Blob so a re-import does
// not require the user to re-pick the file from disk.

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
export function registerImport(blob: Blob, filename: string, source: ImportSource, metadata?: unknown, thumbnail?: string): ImportInboxEntry {
  const key = importKey(filename, metadata);
  const existingIdx = entries.findIndex(e => importKey(e.filename, e.metadata) === key);
  if (existingIdx >= 0) entries.splice(existingIdx, 1);
  const entry: ImportInboxEntry = {
    id: `imp_${Date.now().toString(36)}_${nextSeq++}`,
    blob,
    filename,
    source,
    sizeBytes: blob.size,
    timestamp: Date.now(),
    metadata,
    thumbnail,
  };
  entries.unshift(entry);
  while (entries.length > MAX_ENTRIES) entries.pop();
  notify();
  return entry;
}

/** Snapshot of the inbox, newest first. */
export function listImports(): ImportInboxEntry[] {
  return entries.slice();
}

/** Look up a single entry by id. */
export function getImport(id: string): ImportInboxEntry | null {
  return entries.find(e => e.id === id) ?? null;
}

/** Drop everything from the inbox. */
export function clearImports(): void {
  if (entries.length === 0) return;
  entries.length = 0;
  notify();
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
