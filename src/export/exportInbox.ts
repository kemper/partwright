// Recent-exports inbox: a newest-first ring buffer of the last N export blobs
// the app produced. Both the toolbar (Recent Exports list) and the AI console
// API read from this — so an export the human triggered remains downloadable
// and inspectable without re-running the geometry.
//
// The buffer lives in memory (so reads stay synchronous) but is mirrored to
// IndexedDB on every mutation and rehydrated on boot, so the Recent Exports
// list survives a page refresh. Persistence is best-effort: if IndexedDB is
// unavailable the in-memory list still works for the session.

import { applyInboxMutation, clearInboxStore, getInboxRecords } from '../storage/db';
import { reconcileInbox } from '../storage/inboxBuffer';

const STORE = 'exportInbox';
const MAX_ENTRIES = 10;

export interface ExportInboxEntry {
  id: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  source: string;
  sizeBytes: number;
  timestamp: number;
}

const entries: ExportInboxEntry[] = [];
const listeners = new Set<() => void>();

let nextSeq = 1;

function notify() {
  for (const fn of listeners) fn();
}

/** Add an export to the inbox. Newest entries are at index 0. */
export function registerExport(
  blob: Blob,
  filename: string,
  source: string,
  mimeType?: string,
): ExportInboxEntry {
  const entry: ExportInboxEntry = {
    id: `exp_${Date.now().toString(36)}_${nextSeq++}`,
    blob,
    filename,
    mimeType: mimeType ?? blob.type ?? 'application/octet-stream',
    source,
    sizeBytes: blob.size,
    timestamp: Date.now(),
  };
  entries.unshift(entry);
  const evicted: string[] = [];
  while (entries.length > MAX_ENTRIES) {
    const popped = entries.pop();
    if (popped) evicted.push(popped.id);
  }
  notify();
  // Mirror to IndexedDB: persist the new entry, drop any overflowed id.
  void applyInboxMutation(STORE, entry, evicted).catch(err => console.debug('exportInbox persist failed', err));
  return entry;
}

/** Snapshot of the inbox, newest first. */
export function listExports(): ExportInboxEntry[] {
  return entries.slice();
}

/** Look up a single entry by id. */
export function getExport(id: string): ExportInboxEntry | null {
  return entries.find(e => e.id === id) ?? null;
}

/** Drop everything from the inbox (used by the toolbar Clear action). */
export function clearExports(): void {
  if (entries.length === 0) return;
  entries.length = 0;
  notify();
  void clearInboxStore(STORE).catch(err => console.debug('exportInbox clear failed', err));
}

/** Rehydrate the in-memory buffer from IndexedDB on boot so the Recent Exports
 *  list survives a refresh. Safe to call once at startup; merges with anything
 *  already registered this session and reconciles storage back to the cap. */
export async function hydrateExportInbox(): Promise<void> {
  let persisted: ExportInboxEntry[];
  try {
    persisted = await getInboxRecords<ExportInboxEntry>(STORE);
  } catch (err) {
    console.debug('exportInbox hydrate failed', err);
    return;
  }
  if (persisted.length === 0) return;
  const { merged, staleIds } = reconcileInbox(entries, persisted, MAX_ENTRIES);
  entries.length = 0;
  entries.push(...merged);
  notify();
  if (staleIds.length > 0) {
    void applyInboxMutation(STORE, null, staleIds).catch(err => console.debug('exportInbox reconcile failed', err));
  }
}

/** Subscribe to inbox changes. Returns an unsubscribe fn. */
export function onExportInboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
