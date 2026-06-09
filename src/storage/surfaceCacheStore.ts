// Persistent, content-addressed cache for computed `api.surface.*` textures.
//
// The in-memory memo cache (`src/surface/surfaceOps.ts`) avoids recomputing a
// texture within a session; this store extends that across reloads/sessions. It
// is keyed by the same `hash(code + params + op-chain)` memo key, so a reopened
// textured session can seed the in-memory cache from here and render instantly
// instead of recomputing the (potentially slow) texture.
//
// It is deliberately NOT part of a saved Version or session export — the code
// stays the artifact; this is a derived local cache. On a fresh machine (or
// after a "clear all data") it simply recomputes. An LRU cap keeps it bounded.

import { openPartwrightDB } from './db';
import type { MeshData } from '../geometry/types';

const STORE = 'surfaceCache';
const MAX_ENTRIES = 64;

interface SurfaceCacheRow {
  key: string;
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number; numProp: number };
  savedAt: number;
}

/** Look up a previously-computed textured mesh by its memo key. Returns null on
 *  a miss or any error (the caller just recomputes). */
export async function getPersistedSurface(key: string): Promise<MeshData | null> {
  try {
    const db = await openPartwrightDB();
    if (!db.objectStoreNames.contains(STORE)) return null;
    return await new Promise<MeshData | null>((resolve) => {
      const txn = db.transaction(STORE, 'readonly');
      const req = txn.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as SurfaceCacheRow | undefined;
        resolve(row ? row.mesh : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Persist a computed textured mesh under its memo key, then prune to the cap.
 *  Best-effort: storage failures are swallowed (the in-memory cache still
 *  serves this session). */
export async function putPersistedSurface(key: string, mesh: MeshData): Promise<void> {
  try {
    const db = await openPartwrightDB();
    if (!db.objectStoreNames.contains(STORE)) return;
    const row: SurfaceCacheRow = {
      key,
      mesh: {
        vertProperties: mesh.vertProperties,
        triVerts: mesh.triVerts,
        numVert: mesh.numVert,
        numTri: mesh.numTri,
        numProp: mesh.numProp,
      },
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve) => {
      const txn = db.transaction(STORE, 'readwrite');
      txn.objectStore(STORE).put(row);
      txn.oncomplete = () => resolve();
      txn.onerror = () => resolve();
    });
    await pruneSurfaceCache(db);
  } catch {
    /* best-effort */
  }
}

/** Evict the oldest rows beyond MAX_ENTRIES (LRU by savedAt). Runs in a single
 *  readwrite transaction — no awaits between the count and the cursor deletes,
 *  per the IndexedDB transaction rules in CLAUDE.md. */
function pruneSurfaceCache(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const txn = db.transaction(STORE, 'readwrite');
    const store = txn.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_ENTRIES;
      if (excess <= 0) return;
      let removed = 0;
      const cursorReq = store.index('savedAt').openCursor(); // ascending → oldest first
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= excess) return;
        cursor.delete();
        removed++;
        cursor.continue();
      };
    };
    txn.oncomplete = () => resolve();
    txn.onerror = () => resolve();
  });
}

/** Diagnostic/test hook — number of rows in the persistent surface cache. */
export async function surfaceCacheCount(): Promise<number> {
  try {
    const db = await openPartwrightDB();
    if (!db.objectStoreNames.contains(STORE)) return 0;
    return await new Promise<number>((resolve) => {
      const txn = db.transaction(STORE, 'readonly');
      const req = txn.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}
