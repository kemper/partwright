// Persistent "recent attachments" store backing the attach-image picker.
// When the user attaches an image (from disk, paste, or drag-drop), we
// record it here so they can re-attach it from the picker without finding
// the file on disk again. Keyed by SHA-256 of the bytes so the same image
// uploaded twice doesn't create two rows.

import { openPartwrightDB } from '../storage/db';
import type { ImageSource } from './types';

const STORE = 'aiAttachments';

/** Hard ceiling on rows kept in the store. Pruned oldest-first when
 *  putAttachment crosses the limit. Twenty thumbnails comfortably fit in
 *  a single modal scroll and bound IndexedDB usage at ~100 MB worst case
 *  (5 MB Anthropic per-image cap × 20). */
const MAX_ATTACHMENTS = 20;

export interface RecentAttachment {
  /** SHA-256 hex of the image bytes — also serves as the keyPath. */
  id: string;
  /** Raw base64 bytes (no data: prefix), matches ImageSource.data. */
  data: string;
  mediaType: ImageSource['mediaType'];
  /** User-visible label; usually the original filename. */
  label: string;
  /** When the user first uploaded this file. */
  addedAt: number;
  /** Bumped every time the user re-attaches this image. Drives recency sort. */
  lastUsedAt: number;
  /** Decoded byte length. Stored so the picker can show file size without
   *  decoding the base64. */
  sizeBytes: number;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txComplete(txn: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}

async function sha256Hex(base64: string): Promise<string> {
  // atob + Uint8Array round-trip is fine for the sizes we deal with
  // (a few MB max); avoids pulling in a hashing library.
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Most-recently-used attachments first. */
export async function listRecentAttachments(): Promise<RecentAttachment[]> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readonly');
  const all = await reqToPromise(txn.objectStore(STORE).getAll()) as RecentAttachment[];
  await txComplete(txn);
  return all.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Write or refresh an attachment. Returns the stored row's id so callers
 *  can re-fetch later. Prunes oldest rows past MAX_ATTACHMENTS. */
export async function putAttachment(img: ImageSource): Promise<string> {
  const id = await sha256Hex(img.data);
  const now = Date.now();
  const sizeBytes = Math.floor((img.data.length * 3) / 4);
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  const store = txn.objectStore(STORE);
  // Do the whole read→write→prune inside request callbacks so they all stay in
  // ONE transaction. Awaiting between the get and the put lets IndexedDB
  // auto-commit the txn before the put is queued (TransactionInactiveError),
  // and across two tabs attaching the same image concurrently it drops one
  // tab's write — the same hazard recordUsage/updateSession avoid by never
  // awaiting mid-transaction.
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const existing = getReq.result as RecentAttachment | undefined;
    if (existing) {
      existing.lastUsedAt = now;
      // Refresh the label too — a user re-uploading the same bytes under a
      // different filename probably wants the latest name shown.
      if (img.label) existing.label = img.label;
      store.put(existing);
      return;
    }
    const row: RecentAttachment = {
      id,
      data: img.data,
      mediaType: img.mediaType,
      label: img.label ?? 'attachment',
      addedAt: now,
      lastUsedAt: now,
      sizeBytes,
    };
    store.put(row);
    // Prune. Pull the full list inside the same txn so the count is
    // consistent — getAll on a live store with a pending put returns the
    // post-put state. Drop the oldest beyond the cap, still from inside a
    // request callback so no await splits the transaction.
    const allReq = store.getAll();
    allReq.onsuccess = () => {
      const all = allReq.result as RecentAttachment[];
      if (all.length > MAX_ATTACHMENTS) {
        const oldest = all
          .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
          .slice(0, all.length - MAX_ATTACHMENTS);
        for (const drop of oldest) store.delete(drop.id);
      }
    };
  };
  await txComplete(txn);
  return id;
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  txn.objectStore(STORE).delete(id);
  await txComplete(txn);
}

/** Convert a stored row back to the ImageSource shape consumed by the
 *  chat pipeline. */
export function attachmentToImageSource(a: RecentAttachment): ImageSource {
  return { data: a.data, mediaType: a.mediaType, label: a.label };
}
