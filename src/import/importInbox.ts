// Recent-imports inbox: an in-memory ring buffer of the last N files the user
// imported. Mirrors the Recent Exports inbox so the toolbar's Import dropdown
// can offer one-click re-import. Holds the underlying Blob so a re-import does
// not require the user to re-pick the file from disk.

const MAX_ENTRIES = 10;

export type ImportSource = 'JSON' | 'JS' | 'SCAD' | 'STL' | 'STEP';

export interface ImportInboxEntry {
  id: string;
  blob: Blob;
  filename: string;
  source: ImportSource;
  sizeBytes: number;
  timestamp: number;
}

const entries: ImportInboxEntry[] = [];
const listeners = new Set<() => void>();

let nextSeq = 1;

function notify() {
  for (const fn of listeners) fn();
}

/** Add an entry to the inbox. Newest entries are at index 0. */
export function registerImport(blob: Blob, filename: string, source: ImportSource): ImportInboxEntry {
  const entry: ImportInboxEntry = {
    id: `imp_${Date.now().toString(36)}_${nextSeq++}`,
    blob,
    filename,
    source,
    sizeBytes: blob.size,
    timestamp: Date.now(),
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
  return null;
}
