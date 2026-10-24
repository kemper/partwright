// Saved Custom-provider endpoints — IndexedDB storage (`aiEndpoints` store).
//
// Lives next to the API keys in the partwright database, which asks the
// browser for persistent (eviction-exempt) storage on every save, and is
// untouched by AI-settings resets, preset changes, or a session restoring
// its own toggles — only an explicit delete, the Uninstall modal's "API keys"
// category, or clearing site data removes it. The Custom tab also offers a
// backup file (endpointProfiles.ts) for moving to another browser or
// surviving a site-data wipe.

import { openPartwrightDB } from '../storage/db';
import { requestPersistentStorage } from '../storage/persist';
import { deleteKey, getKey, putKey } from './db';
import { findEndpointForUrl, seedEndpoint, type SavedEndpoint } from './endpointProfiles';

const STORE = 'aiEndpoints';

function txComplete(txn: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}

function sortByCreated(list: SavedEndpoint[]): SavedEndpoint[] {
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

export async function listEndpoints(): Promise<SavedEndpoint[]> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readonly');
  const req = txn.objectStore(STORE).getAll();
  await txComplete(txn);
  return sortByCreated(req.result as SavedEndpoint[]);
}

/** Insert or replace endpoints in one transaction. */
export async function putEndpoints(list: SavedEndpoint[]): Promise<void> {
  if (list.length === 0) return;
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  const store = txn.objectStore(STORE);
  for (const e of list) store.put(e);
  await txComplete(txn);
  void requestPersistentStorage();
}

export async function putEndpoint(e: SavedEndpoint): Promise<void> {
  await putEndpoints([e]);
}

export async function deleteEndpoint(id: string): Promise<void> {
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  txn.objectStore(STORE).delete(id);
  await txComplete(txn);
}

/** Return the saved list, first creating one entry from the current
 *  single-endpoint config when the store is empty (upgrade path — keeps a
 *  working connection as-is). The emptiness check and the add share one
 *  readwrite transaction, so two tabs opening settings at once can't both
 *  seed. */
export async function ensureEndpointsSeeded(
  current: { baseUrl: string; model: string; models: string[]; reasoningEffort: boolean },
  id: string,
): Promise<SavedEndpoint[]> {
  const apiKey = (await getKey('custom'))?.apiKey ?? '';
  const db = await openPartwrightDB();
  const txn = db.transaction(STORE, 'readwrite');
  const store = txn.objectStore(STORE);
  let result: SavedEndpoint[] = [];
  const getReq = store.getAll();
  getReq.onsuccess = () => {
    result = getReq.result as SavedEndpoint[];
    if (result.length > 0) return;
    const seed = seedEndpoint({ ...current, apiKey }, id);
    store.add(seed);
    result = [seed];
  };
  await txComplete(txn);
  void requestPersistentStorage();
  return sortByCreated(result);
}

/** The saved endpoint the Custom provider is pointed at: matched by base
 *  URL, with the legacy `aiKeys` 'custom' row (which every apply mirrors)
 *  breaking ties — so two endpoints for one URL (two bridge entries for
 *  localhost:8317, say) resolve to the one actually selected, not merely the
 *  last one edited. */
export async function findActiveEndpoint(baseUrl: string, list?: SavedEndpoint[]): Promise<SavedEndpoint | null> {
  const legacy = (await getKey('custom'))?.apiKey ?? '';
  return findEndpointForUrl(list ?? await listEndpoints(), baseUrl, legacy);
}

/** The API key to send to a Custom endpoint: the active saved endpoint's
 *  key when `baseUrl` matches one, else the legacy single `aiKeys` 'custom'
 *  row. Matching by URL keeps the key right when a session restores toggles
 *  that point at a different saved endpoint than the last one selected. */
export async function resolveCustomApiKey(baseUrl: string): Promise<string> {
  try {
    const hit = await findActiveEndpoint(baseUrl);
    if (hit) return hit.apiKey;
  } catch { /* store unavailable — fall back to the legacy row */ }
  return (await getKey('custom'))?.apiKey ?? '';
}

/** Mirror the active endpoint's key into the legacy `aiKeys` 'custom' row
 *  (usage counters preserved). Empty key → delete the row. */
export async function syncLegacyCustomKey(apiKey: string): Promise<void> {
  const k = apiKey.trim();
  const existing = await getKey('custom');
  if (!k) { if (existing) await deleteKey('custom'); return; }
  if (existing?.apiKey === k) return;
  await putKey({
    provider: 'custom',
    apiKey: k,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsed: Date.now(),
    totalInputTokens: existing?.totalInputTokens ?? 0,
    totalOutputTokens: existing?.totalOutputTokens ?? 0,
    totalCostUsd: existing?.totalCostUsd ?? 0,
  });
}

/** Remember a model picked outside the settings modal (the AI panel's
 *  dropdown) as the matching endpoint's default, so selecting the endpoint
 *  later doesn't revert it. Best-effort. */
export async function rememberEndpointModel(baseUrl: string, model: string): Promise<void> {
  try {
    const hit = await findActiveEndpoint(baseUrl);
    if (!hit || hit.model === model) return;
    await putEndpoint({ ...hit, model, updatedAt: Date.now() });
  } catch { /* best-effort */ }
}
