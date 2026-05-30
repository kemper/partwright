// IndexedDB layer for the AI subsystem. Reuses the existing partwright DB
// connection (schema bumped to v3 in src/storage/db.ts) so we don't open a
// second IndexedDB instance.

import { openPartwrightDB } from '../storage/db';
import { requestPersistentStorage } from '../storage/persist';
import type { ChatMessage, KeyRecord, Provider } from './types';

const KEYS_STORE = 'aiKeys';
const CHATS_STORE = 'aiChats';

/** Sentinel sessionId used for chat that happens before a session is opened.
 *  Restored when the user reopens the editor with no session selected. */
export const GLOBAL_CHAT_BUCKET = '__global__';

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

// === Keys ===

export async function getKey(provider: Provider): Promise<KeyRecord | null> {
  const db = await openPartwrightDB();
  const txn = db.transaction(KEYS_STORE, 'readonly');
  const record = await reqToPromise(txn.objectStore(KEYS_STORE).get(provider)) as KeyRecord | undefined;
  await txComplete(txn);
  return record ?? null;
}

export async function putKey(record: KeyRecord): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(KEYS_STORE, 'readwrite');
  txn.objectStore(KEYS_STORE).put(record);
  await txComplete(txn);
  // Saving a key is the moment its durability matters most. Ask the browser to
  // make storage persistent so mobile (iOS Safari ITP) doesn't evict it later.
  // Fire-and-forget: never block or fail the save on the request.
  void requestPersistentStorage();
}

export async function deleteKey(provider: Provider): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(KEYS_STORE, 'readwrite');
  txn.objectStore(KEYS_STORE).delete(provider);
  await txComplete(txn);
}

/** Bumps usage counters on the existing record. No-op when no key exists
 *  (the record is created by the key modal — we only update it). */
export async function recordUsage(
  provider: Provider,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(KEYS_STORE, 'readwrite');
  const store = txn.objectStore(KEYS_STORE);
  // Issue the put inside the get's callback so both requests live in the same
  // transaction. Awaiting between get and put lets IndexedDB auto-commit the
  // txn before the put is queued (TransactionInactiveError / lost update).
  const getReq = store.get(provider);
  getReq.onsuccess = () => {
    const existing = getReq.result as KeyRecord | undefined;
    if (!existing) return;
    existing.lastUsed = Date.now();
    existing.totalInputTokens += inputTokens;
    existing.totalOutputTokens += outputTokens;
    existing.totalCostUsd += costUsd;
    store.put(existing);
  };
  await txComplete(txn);
}

// === Chats ===

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await openPartwrightDB();
  const txn = db.transaction(CHATS_STORE, 'readonly');
  const idx = txn.objectStore(CHATS_STORE).index('sessionId');
  const messages = await reqToPromise(idx.getAll(IDBKeyRange.only(sessionId))) as ChatMessage[];
  await txComplete(txn);
  return messages.sort((a, b) => a.seq - b.seq);
}

export async function putMessages(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const db = await openPartwrightDB();
  const txn = db.transaction(CHATS_STORE, 'readwrite');
  const store = txn.objectStore(CHATS_STORE);
  for (const m of messages) store.put(m);
  await txComplete(txn);
}

export async function deleteMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const db = await openPartwrightDB();
  const txn = db.transaction(CHATS_STORE, 'readwrite');
  const store = txn.objectStore(CHATS_STORE);
  for (const id of messageIds) store.delete(id);
  await txComplete(txn);
}

export async function clearChat(sessionId: string): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(CHATS_STORE, 'readwrite');
  const store = txn.objectStore(CHATS_STORE);
  const idx = store.index('sessionId');
  const req = idx.openCursor(IDBKeyRange.only(sessionId));
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
  await txComplete(txn);
}

/** Merge every chat message from bucket `from` into session `to`. The combined
 *  transcript is re-sequenced chronologically (by createdAt, then prior seq) so
 *  ordering is stable and seq values can't collide. Used to reunite a single
 *  conversation that got split across buckets when the active session changed
 *  mid-turn (chatLoop stamps each message with the session active at turn start,
 *  so a mid-turn createSession strands the earlier turns under the old bucket).
 *  Returns the number of messages moved out of `from`.
 *
 *  `onlyIfTargetEmpty` (used by the automatic post-turn reunite) restricts the
 *  merge to a fresh session so a conversation is never auto-folded into one that
 *  already has its own distinct chat; the manual recovery path leaves it off. */
export async function mergeChatBucket(
  from: string,
  to: string,
  opts: { onlyIfTargetEmpty?: boolean } = {},
): Promise<number> {
  if (from === to || to === GLOBAL_CHAT_BUCKET) return 0;
  const fromMsgs = await listMessages(from);
  if (fromMsgs.length === 0) return 0;
  const toMsgs = await listMessages(to);
  if (opts.onlyIfTargetEmpty && toMsgs.length > 0) return 0;
  const combined = [...toMsgs, ...fromMsgs].sort(
    (a, b) => (a.createdAt - b.createdAt) || (a.seq - b.seq),
  );
  combined.forEach((m, i) => { m.sessionId = to; m.seq = i; });
  await putMessages(combined);
  return fromMsgs.length;
}
