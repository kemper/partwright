// Inventory + selective wipe of everything Partwright stores in the browser.
// Backs the Data tab (browse stored data by category and entity) and the
// Uninstall / Start-fresh modal (delete chosen categories).

import { openPartwrightDB } from './db';

export type StoreName = 'sessions' | 'versions' | 'parts' | 'notes' | 'aiKeys' | 'aiChats' | 'aiAttachments';

export const ALL_STORES: StoreName[] = ['sessions', 'versions', 'parts', 'notes', 'aiKeys', 'aiChats', 'aiAttachments'];

export const STORE_LABELS: Record<StoreName, string> = {
  sessions: 'Sessions',
  versions: 'Versions',
  parts: 'Parts',
  notes: 'Session notes',
  aiKeys: 'AI API keys',
  aiChats: 'AI chat messages',
  aiAttachments: 'Image attachments',
};

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

export interface StoreCount {
  store: StoreName;
  count: number;
}

export async function getStoreCounts(): Promise<StoreCount[]> {
  const db = await openPartwrightDB();
  const out: StoreCount[] = [];
  for (const store of ALL_STORES) {
    const txn = db.transaction(store, 'readonly');
    const count = await reqToPromise(txn.objectStore(store).count());
    await txComplete(txn);
    out.push({ store, count });
  }
  return out;
}

/** All records in a store. Used by the Data tab's drill-down. */
export async function getStoreRecords(store: StoreName): Promise<unknown[]> {
  const db = await openPartwrightDB();
  const txn = db.transaction(store, 'readonly');
  const records = await reqToPromise(txn.objectStore(store).getAll());
  await txComplete(txn);
  return records as unknown[];
}

export interface LocalStorageEntry {
  key: string;
  value: string;
  bytes: number;
}

/** Partwright's localStorage entries (preferences/settings). */
export function listLocalStorageEntries(): LocalStorageEntry[] {
  const out: LocalStorageEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!(key.startsWith('partwright') || key.startsWith('pw-') || key === 'editor-auto-format')) continue;
      const value = localStorage.getItem(key) ?? '';
      out.push({ key, value, bytes: value.length });
    }
  } catch {
    // localStorage may be unavailable (private mode).
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// === Selective wipe ===

export interface WipeSelection {
  /** Sessions, parts, versions, and notes (the core modeling data + legacy DB). */
  modelingData: boolean;
  /** AI chat transcripts. */
  chats: boolean;
  /** Stored AI provider API keys. */
  apiKeys: boolean;
  /** Recent image attachments. */
  attachments: boolean;
  /** Preferences & settings (localStorage). */
  preferences: boolean;
  /** Downloaded local AI model weights (multi-GB). */
  models: boolean;
}

export const FULL_WIPE: WipeSelection = {
  modelingData: true,
  chats: true,
  apiKeys: true,
  attachments: true,
  preferences: true,
  models: true,
};

async function clearStores(stores: StoreName[]): Promise<void> {
  if (stores.length === 0) return;
  const db = await openPartwrightDB();
  const txn = db.transaction(stores, 'readwrite');
  for (const s of stores) txn.objectStore(s).clear();
  await txComplete(txn);
}

function deleteDatabaseBestEffort(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function clearLocalStoragePrefs(): void {
  for (const { key } of listLocalStorageEntries()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

async function clearModelCaches(): Promise<void> {
  // WebLLM weights live in the Cache Storage API (and OPFS where available).
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // ignore
  }
  // Best-effort OPFS clear.
  try {
    const storage = navigator.storage as unknown as { getDirectory?: () => Promise<unknown> };
    const root = storage.getDirectory ? await storage.getDirectory() : null;
    const dir = root as unknown as {
      entries?: () => AsyncIterable<[string, unknown]>;
      removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
    } | null;
    if (dir?.entries && dir.removeEntry) {
      for await (const [name] of dir.entries()) {
        await dir.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

/** Delete the selected categories. Caller should reload the page afterward so
 *  in-memory state is rebuilt from the now-empty stores. */
export async function wipeData(sel: WipeSelection): Promise<void> {
  const stores: StoreName[] = [];
  if (sel.modelingData) stores.push('sessions', 'versions', 'parts', 'notes');
  if (sel.chats) stores.push('aiChats');
  if (sel.apiKeys) stores.push('aiKeys');
  if (sel.attachments) stores.push('aiAttachments');
  await clearStores(stores);
  if (sel.modelingData) await deleteDatabaseBestEffort('mainifold');
  if (sel.preferences) clearLocalStoragePrefs();
  if (sel.models) await clearModelCaches();
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
