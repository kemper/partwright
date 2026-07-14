// IndexedDB access for the `syncTargets` store (added in db.ts v9). One row per
// target id holds the durable connection state — a File System Access directory
// handle for 'local', and the Drive folder id + file-id map for 'drive'.
// Access tokens are never persisted here.

import { openPartwrightDB } from '../storage/db';
import { requestPersistentStorage } from '../storage/persist';
import type { LocalTargetRecord, DriveTargetRecord, SyncTargetId } from './syncTypes';

const STORE = 'syncTargets';

type TargetRecord = LocalTargetRecord | DriveTargetRecord;

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

export async function getLocalTarget(): Promise<LocalTargetRecord | null> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readonly');
  const rec = (await reqToPromise(txn.objectStore(STORE).get('local'))) as LocalTargetRecord | undefined;
  await txComplete(txn);
  return rec ?? null;
}

export async function getDriveTarget(): Promise<DriveTargetRecord | null> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readonly');
  const rec = (await reqToPromise(txn.objectStore(STORE).get('drive'))) as DriveTargetRecord | undefined;
  await txComplete(txn);
  return rec ?? null;
}

export async function putTarget(record: TargetRecord): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  txn.objectStore(STORE).put(record);
  await txComplete(txn);
  // A linked backup target is durability-critical — ask the browser to persist
  // storage so mobile eviction doesn't silently drop the handle/folder link.
  void requestPersistentStorage();
}

export async function deleteTarget(id: SyncTargetId): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  txn.objectStore(STORE).delete(id);
  await txComplete(txn);
}
