// IndexedDB storage for sessions and versions

import {
  type AttachedImage,
  type SessionAttachment,
  type AttachmentKind,
  normalizeAttachment,
} from './attachment';

export type { AttachedImage, SessionAttachment, AttachmentKind } from './attachment';
import { packStoredArrays, unpackStoredArrays } from './storedArrays';
import { getConfig } from '../config/appConfig';

/** A version as written to the `versions` store: its big typed arrays (import
 *  meshes, persisted textures, detected parts) become Blobs, so the put does
 *  not copy them on the main thread. Every reader below unpacks; records that
 *  only move between stores (the bin, migrations) stay packed. */
function storedVersion(v: Version): Version {
  return packStoredArrays(v, getConfig().renderer.storedArrayBlobMinKB * 1024);
}

function loadedVersion(v: Version): Promise<Version>;
function loadedVersion(v: Version | null | undefined): Promise<Version | null>;
async function loadedVersion(v: Version | null | undefined): Promise<Version | null> {
  return v ? unpackStoredArrays(v) : null;
}

export interface Session {
  id: string;
  name: string;
  created: number;
  updated: number;
  /** Typed project attachments (reference photos, spec PDFs, reference models,
   *  notes…) — the generalization of the old `images` list. Survives an AI
   *  chat clear and is exported with the session. Legacy `images` /
   *  `referenceImages` shapes migrate into this field on read
   *  ({@link migrateSessionImages}). */
  attachments?: SessionAttachment[] | null;
  /** Modeling language for this session. Missing = 'manifold-js'. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  /** Id of the part that is active when the session is (re)opened. Missing =
   *  fall back to the first part by `order`. Set on every part switch so the
   *  editor restores to the part the user last worked on. */
  currentPartId?: string;
  /** Last-used AI config for this session, restored when the session is
   *  (re)opened or taken control of in another tab — so each session carries
   *  its own assistant/provider/model and toggle settings across tabs without
   *  live-bleeding between concurrently-open windows.
   *
   *  `provider`/`model` are the human-readable summary (and the back-compat
   *  shape pre-dating `toggles`). `toggles` is the full {@link ChatToggles}
   *  snapshot (stored opaquely as a record to keep this storage layer decoupled
   *  from the AI types) and `preset` mirrors the settings preset. Sessions saved
   *  before this field gains `toggles` simply restore provider/model only. */
  aiPreference?: { provider: string; model: string; toggles?: Record<string, unknown>; preset?: string; /** AI settings rev the toggles were saved under (absent = before rev 2). */ settingsRev?: number };
  /** Pinned thumbnail camera angle (degrees). When set, captured thumbnails
   *  (catalog tiles, gallery, version snapshots) render from this azimuth /
   *  elevation instead of the default iso 3/4 view — so a faced model can show
   *  its front in the tile without baking orientation into the geometry. Set
   *  via `partwright.setThumbnailCamera({ azimuth, elevation })`; absent ⇒ the
   *  default iso view. Persisted so re-bakes and reloads reuse the angle. */
  thumbCamera?: { azimuth: number; elevation: number };
  /** Persisted interactive working-view camera (world-space position + orbit
   *  target). Unlike `thumbCamera` (which only steers thumbnail capture), this
   *  records the angle/zoom the user last orbited the live viewport to, so it
   *  survives reload / reopening the session instead of snapping back to the
   *  default 3/4 framing. Written (debounced) when the user finishes an orbit;
   *  restored on session open. Absent ⇒ auto-frame on open. */
  workCamera?: { position: [number, number, number]; target: [number, number, number] };
}

/** A modeling target within a session. A session holds one or more parts; each
 *  part owns its own independent version history, code, color regions,
 *  annotations, and imported meshes. The "current part" pointer (held in
 *  {@link Session.currentPartId} and in the session-manager runtime state) sits
 *  above the "current version" pointer, so the editor always shows one part at a
 *  time. */
export interface Part {
  id: string;
  sessionId: string;
  name: string;
  /** Display order within the session's part list (ascending). */
  order: number;
  /** Optional group name. Parts sharing a group are threaded together under a
   *  collapsible group header in the part list. Absent/empty ⇒ ungrouped
   *  (rendered at the top level). Purely a display grouping — it doesn't affect
   *  a part's independent version history. @since schema 1.19 */
  group?: string;
  created: number;
  updated: number;
}

/** Suggested labels offered as quick picks in the UI. Items whose label
 *  matches one of these (case-insensitive) sort earlier in the image
 *  strip in the order they appear here. */
export const PRESET_LABELS = ['Front', 'Right', 'Back', 'Left', 'Top', 'Perspective'] as const;

/** Returns the preset index for a label (case-insensitive), or -1 if it
 *  doesn't match any preset. */
export function presetIndex(label: string | undefined): number {
  if (!label) return -1;
  const norm = label.trim().toLowerCase();
  for (let i = 0; i < PRESET_LABELS.length; i++) {
    if (PRESET_LABELS[i].toLowerCase() === norm) return i;
  }
  return -1;
}

/** Legacy angle keys that pre-unification data was tagged with. */
type LegacyImageAngle = 'front' | 'right' | 'back' | 'left' | 'top' | 'perspective';
const LEGACY_ANGLES: readonly LegacyImageAngle[] = ['front', 'right', 'back', 'left', 'top', 'perspective'];

/** The mesh-level operation that produced a version. Set alongside
 *  {@link Version.parentVersionId} when a version is derived from another
 *  (e.g. a simplify run that wraps the result in `Manifold.ofMesh`). */
export type VersionOperation = 'simplify' | 'enhance' | 'paint' | 'import' | 'manual';

export interface Version {
  id: string;
  sessionId: string;
  /** Owning part. Versions are indexed per-part, so each part has its own
   *  v1, v2, … sequence. Denormalized `sessionId` is retained for
   *  session-scoped queries (recent-session grids) and cascade deletes.
   *  Legacy versions written before multi-part support are stamped with their
   *  session's default part id by {@link migratePartsData}. */
  partId: string;
  index: number;
  code: string;
  geometryData: Record<string, unknown> | null;
  thumbnail: Blob | null;
  label: string;
  timestamp: number;
  notes?: string;
  /** Modeling language this version was authored in. Missing = fall back to
   *  the owning session's `language` (then to 'manifold-js'). Versions can mix
   *  languages within a single session — navigating to one swaps the engine. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  /** Snapshot of annotations (freehand strokes + pinned text labels) at the time
   *  this version was saved. Shape matches `SerializedAnnotation[]` from the
   *  annotations module — kept as `unknown[]` here to preserve db-layer isolation. */
  annotations?: unknown[];
  /** External meshes imported into this version (STL today). Exposed to the
   *  sandbox as `api.imports[i]` so user code can call `Manifold.ofMesh(...)`.
   *  Kept as `unknown[]` here to preserve db-layer isolation. */
  importedMeshes?: unknown[];
  /** Customizer parameter overrides for this version — the tweaked values the
   *  user dialed in against the model's `api.params({...})` schema. Re-applied
   *  when the version is loaded so its geometry matches its saved thumbnail.
   *  Only keys that differ from the model defaults are stored; absent when the
   *  version uses all defaults (or declares no parameters). */
  paramValues?: Record<string, number | boolean | string>;
  /** Companion SCAD files for this version. Maps MEMFS-relative path → source
   *  text (e.g. `{"models.scad": "function models() = ..."}`) so that
   *  `include <models.scad>` inside the main code resolves at compile time.
   *  Only present for SCAD sessions that need companion files. */
  companionFiles?: Record<string, string>;
  /** Computed `api.surface.*` texture result (full-chain memo key + textured
   *  mesh) persisted at save time, so reopening the version renders textured
   *  immediately instead of recomputing the chain — and so the texture's
   *  appearance is pinned to what the user saw when they saved. Shape is
   *  `PersistedSurfaceTexture` (`src/surface/surfaceOpSpec.ts`); kept as
   *  `unknown` here to preserve db-layer isolation (typed arrays survive
   *  IndexedDB's structured clone as-is). Absent on versions saved before this
   *  field existed or without in-code textures — loaders must treat absence as
   *  "recompute on demand". */
  surfaceTexture?: unknown;
  /** The version this was derived from. Set when a mesh-capture operation
   *  (simplify, enhance, paint-bake, import) creates a child version from an
   *  existing parametric version. Absent for versions created from scratch.
   *  The reference may become null if the parent is later deleted. */
  parentVersionId?: string | null;
  /** The operation that produced this version. Set alongside
   *  {@link parentVersionId} when the version is derived from another. */
  operation?: VersionOperation | null;
  /** App semver (package.json `version`, from `buildInfo.version`) that authored
   *  this version — the "last known good" app version for this snapshot. Stamped
   *  at save time. Absent on versions saved before this field existed, and in
   *  dev/test builds where the version resolves to 'unknown' (we store nothing
   *  rather than the placeholder). Read by the cross-major migration seam. */
  appVersion?: string;
  /** Geometry fingerprint of the mesh this version's code built when it was
   *  saved (`ModelFingerprint`, src/geometry/modelFingerprint.ts; opaque here).
   *  Opening the version compares it with the rebuilt mesh to notice when the
   *  code now builds a different model. Absent on versions saved before
   *  fingerprints existed, or by a save that had no matching run. */
  fingerprint?: unknown;
  /** The mesh this version displayed when saved (`SavedMesh`,
   *  src/storage/versionMesh.ts; opaque here), colours included. Kept ONLY on
   *  each object's newest version: saving a new version drops the previous
   *  newest version's copy, so storage grows with objects, not history. Never
   *  stored for a version whose model is already stored mesh data (imports, an
   *  in-code surface texture, a baked voxel grid). */
  latestMesh?: unknown;
}

/** Editor working buffer scoped to (session, part, language). One slot per
 *  (part, language): switching parts or the toolbar language toggle stashes the
 *  outgoing code here and restores the target slot's. Persisted so a reload
 *  doesn't lose in-progress work. Cascade-deleted with the session (sessionId
 *  index); a deleted part's drafts move to the deleted-objects bin with it. */
export interface SessionDraft {
  /** Composite key: `${sessionId}:${partId}:${language}` (with partId) or
   *  legacy `${sessionId}:${language}` (pre-per-part drafts). The cascade
   *  delete on session removal uses the `sessionId` index, which covers both
   *  formats. */
  id: string;
  sessionId: string;
  language: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  code: string;
  /** Unsaved companion SCAD files (path → content) for this draft, so a reload
   *  recovers companion-file edits the same way it recovers main-code edits.
   *  Only written for SCAD drafts that have companions; absent otherwise. */
  companionFiles?: Record<string, string>;
  /** Unsaved user paint regions (serialized) so a part that has been painted
   *  but not yet saved keeps its paint across a part switch or reload. Stored
   *  opaquely (unknown[]) to avoid importing color types into this low layer.
   *  Only written when there are non-empty regions; absent otherwise. */
  colorRegions?: unknown[];
  updatedAt: number;
}

function draftId(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel', partId?: string): string {
  return partId ? `${sessionId}:${partId}:${language}` : `${sessionId}:${language}`;
}

export interface SessionNote {
  id: string;
  sessionId: string;
  text: string;
  timestamp: number;
}

const DB_NAME = 'partwright';
const LEGACY_DB_NAME = 'mainifold';
const LEGACY_MIGRATION_KEY = 'partwright-migrated-mainifold-db';
const PARTS_MIGRATION_KEY = 'partwright-migrated-parts';
const DB_VERSION = 11;

/** Opens the partwright IndexedDB. Exposed so the AI subsystem can attach
 *  its own stores (`aiKeys`, `aiChats`) without duplicating the connection. */
export function openPartwrightDB(): Promise<IDBDatabase> {
  return openDB();
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('versions')) {
        const store = db.createObjectStore('versions', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        // Per-part version uniqueness (`partId_index`) is added in the v5 block
        // below; no `sessionId_index` is needed (two parts in one session can
        // each have a v1).
      }
      if (!db.objectStoreNames.contains('notes')) {
        const store = db.createObjectStore('notes', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      // Bumped to v3 with stores backing the in-app AI chat — one row per
      // provider in `aiKeys`, one row per chat message in `aiChats` indexed
      // by sessionId so opening a session restores its transcript.
      if (!db.objectStoreNames.contains('aiKeys')) {
        db.createObjectStore('aiKeys', { keyPath: 'provider' });
      }
      if (!db.objectStoreNames.contains('aiChats')) {
        const store = db.createObjectStore('aiChats', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      // v4: backing store for the attach-image picker's "recent" list.
      // Keyed by SHA-256 of the image bytes so re-uploading the same file
      // bumps lastUsedAt instead of duplicating the row.
      if (!db.objectStoreNames.contains('aiAttachments')) {
        const store = db.createObjectStore('aiAttachments', { keyPath: 'id' });
        store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }
      // v5: multi-part support. Each session holds one or more parts; each part
      // owns its own version history. Version uniqueness moves from
      // [sessionId, index] to [partId, index] because two parts in the same
      // session can both have a v1. The data backfill (one default part per
      // existing session + stamping versions with partId) runs after open in
      // migratePartsData(); here we only adjust structure.
      if (!db.objectStoreNames.contains('parts')) {
        const store = db.createObjectStore('parts', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (db.objectStoreNames.contains('versions')) {
        const versionStore = req.transaction!.objectStore('versions');
        if (!versionStore.indexNames.contains('partId')) {
          versionStore.createIndex('partId', 'partId', { unique: false });
        }
        if (!versionStore.indexNames.contains('partId_index')) {
          // Versions still missing `partId` (pre-backfill) are simply excluded
          // from this index, so the unique constraint can't fire on them.
          versionStore.createIndex('partId_index', ['partId', 'index'], { unique: true });
        }
        if (versionStore.indexNames.contains('sessionId_index')) {
          versionStore.deleteIndex('sessionId_index');
        }
      }
      // v6: per-language editor draft store. One row per (session, language)
      // holds the working buffer for that language, so flipping the toolbar
      // toggle between manifold-js and SCAD preserves both drafts and doesn't
      // wipe the previous editor contents.
      if (!db.objectStoreNames.contains('drafts')) {
        const store = db.createObjectStore('drafts', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      // v7: source-image store for relief imports. One row per relief session
      // holds the original picked image/SVG blob so the import wizard can be
      // reopened (Relief Studio "Edit image", or the Import → relief entry)
      // pre-loaded with the source — no re-upload needed. Keyed by sessionId so
      // the session-delete cascade can drop it with a direct key delete.
      if (!db.objectStoreNames.contains('reliefSources')) {
        db.createObjectStore('reliefSources', { keyPath: 'sessionId' });
      }
      // v8: persisted recent-imports / recent-exports inboxes. Each holds the
      // last N files the user imported / exported (with the underlying Blob) so
      // the toolbar's Recent lists survive a page refresh. The newest-first
      // order and the 10-entry cap are enforced by the in-memory ring buffers
      // (src/import/importInbox.ts, src/export/exportInbox.ts) — these stores
      // just mirror each mutation. Keyed by the entry id so a dedupe/overflow
      // eviction maps to a direct key delete.
      if (!db.objectStoreNames.contains('importInbox')) {
        db.createObjectStore('importInbox', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('exportInbox')) {
        db.createObjectStore('exportInbox', { keyPath: 'id' });
      }
      // v9: the "Recently deleted" bin for objects. Deleting an object moves its
      // part row, versions and drafts into one entry here (keyed by the part id,
      // indexed by sessionId for the per-session list + session-delete cascade)
      // so it can be restored later. Entries expire after
      // `ui.deletedObjectRetentionDays`. Never exported or shared.
      if (!db.objectStoreNames.contains('deletedObjects')) {
        const store = db.createObjectStore('deletedObjects', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        // Lets the rail count a session's unexpired entries without loading
        // their (heavy) versions — see countDeletedObjects.
        store.createIndex('sessionId_deletedAt', ['sessionId', 'deletedAt'], { unique: false });
      }
      // v10: local cache of smooth-paint refined meshes, keyed by a CONTENT key
      // (base mesh + refine descriptors + labels — see paintRefineKey in
      // main.ts), so reopening a painted version skips rebuilding every smooth
      // edge. Not tied to a session or version and never exported: an entry
      // is valid for any version with the same content. The
      // [lastUsed, bytes] index lets eviction walk entries oldest-first and
      // sum their sizes with a key cursor, without loading the meshes.
      if (!db.objectStoreNames.contains('paintRefineCache')) {
        const store = db.createObjectStore('paintRefineCache', { keyPath: 'key' });
        store.createIndex('lastUsed_bytes', ['lastUsed', 'bytes'], { unique: false });
      }
      // v11: saved Custom-provider endpoints (name, base URL, API key, default
      // model, …) — one row per endpoint, keyed by id. See
      // src/ai/customEndpoints.ts.
      if (!db.objectStoreNames.contains('aiEndpoints')) {
        db.createObjectStore('aiEndpoints', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab opens the DB at a higher version, close our connection
      // so its upgrade isn't blocked indefinitely. We drop the cached promise
      // so the next DB access in this tab transparently reopens at the new
      // version.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      migrateLegacyData(db)
        .catch(err => console.warn('Partwright: legacy session migration skipped:', err))
        .then(() => migratePartsData(db))
        .catch(err => console.warn('Partwright: parts migration skipped:', err))
        .finally(() => resolve(db));
    };
    req.onerror = () => reject(req.error);
    // Another tab is holding an older connection open and blocking our upgrade.
    // Surface it; it clears once that tab's onversionchange handler closes its
    // connection (or the user closes the tab).
    req.onblocked = () => {
      console.warn(
        'Partwright: database upgrade is blocked by another open tab. Close other Partwright tabs to continue.',
      );
    };
  });
  return dbPromise;
}

export function generateId(): string {
  // 12-char base62 IDs for local IndexedDB record keys (sessions, parts,
  // versions, images, chat messages). Sourced from crypto.getRandomValues
  // rather than Math.random — these aren't security tokens, but a secure
  // source keeps the entropy unimpeachable and clears static-analysis flags.
  // Rejection sampling (drop bytes ≥ 248 = 4×62) keeps the distribution
  // uniform, avoiding the modulo bias of a raw `byte % 62`.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(12 - id.length));
    for (const b of bytes) {
      if (b < 248) id += chars[b % 62];
    }
  }
  return id;
}

function tx(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
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

function hasLegacyMigrationRun(): boolean {
  try {
    return localStorage.getItem(LEGACY_MIGRATION_KEY) === 'true';
  } catch {
    return false;
  }
}

function markLegacyMigrationRun(): void {
  try {
    localStorage.setItem(LEGACY_MIGRATION_KEY, 'true');
  } catch {
    // Ignore storage failures; migration is only a convenience for local sessions.
  }
}

function hasPartsMigrationRun(): boolean {
  try {
    return localStorage.getItem(PARTS_MIGRATION_KEY) === 'true';
  } catch {
    return false;
  }
}

function markPartsMigrationRun(): void {
  try {
    localStorage.setItem(PARTS_MIGRATION_KEY, 'true');
  } catch {
    // Ignore storage failures; the per-session backfill below is idempotent.
  }
}

async function legacyDBExists(): Promise<boolean> {
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string | null }[]> };
  if (!factory.databases) return true;
  const databases = await factory.databases();
  return databases.some(db => db.name === LEGACY_DB_NAME);
}

function openExistingDB(name: string): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      req.transaction?.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];
  const txn = db.transaction(storeName, 'readonly');
  const records = await reqToPromise(txn.objectStore(storeName).getAll()) as T[];
  await txComplete(txn);
  return records;
}

async function getStoreCount(db: IDBDatabase, storeName: string): Promise<number> {
  if (!db.objectStoreNames.contains(storeName)) return 0;
  const txn = db.transaction(storeName, 'readonly');
  const count = await reqToPromise(txn.objectStore(storeName).count());
  await txComplete(txn);
  return count;
}

async function migrateLegacyData(targetDb: IDBDatabase): Promise<void> {
  if (hasLegacyMigrationRun()) return;

  const targetSessionCount = await getStoreCount(targetDb, 'sessions');
  if (targetSessionCount > 0) {
    markLegacyMigrationRun();
    return;
  }

  if (!(await legacyDBExists())) {
    markLegacyMigrationRun();
    return;
  }

  const legacyDb = await openExistingDB(LEGACY_DB_NAME);
  if (!legacyDb) {
    markLegacyMigrationRun();
    return;
  }

  try {
    const [sessions, versions, notes] = await Promise.all([
      getAllFromStore<Session>(legacyDb, 'sessions'),
      getAllFromStore<Version>(legacyDb, 'versions'),
      getAllFromStore<SessionNote>(legacyDb, 'notes'),
    ]);

    if (sessions.length === 0 && versions.length === 0 && notes.length === 0) {
      markLegacyMigrationRun();
      return;
    }

    const txn = targetDb.transaction(['sessions', 'versions', 'notes'], 'readwrite');
    for (const session of sessions) txn.objectStore('sessions').put(session);
    for (const version of versions) txn.objectStore('versions').put(version);
    for (const note of notes) txn.objectStore('notes').put(note);
    await txComplete(txn);
    console.info(`Partwright: migrated ${sessions.length} legacy session(s) from previous app storage.`);
    markLegacyMigrationRun();
  } finally {
    legacyDb.close();
  }
}

/**
 * Backfill multi-part structure onto pre-v5 data: give every session that has
 * no parts a single default part and stamp that session's versions with the new
 * part's id. Idempotent — sessions that already have a part are skipped — so a
 * run interrupted partway is safely completed on the next open.
 *
 * Reads happen up front in their own (auto-committing) read-only transactions;
 * the writes are batched into one read-write transaction containing only `put`s
 * (no awaits between them) so the transaction can't auto-commit mid-migration.
 */
async function migratePartsData(targetDb: IDBDatabase): Promise<void> {
  if (hasPartsMigrationRun()) return;
  if (!targetDb.objectStoreNames.contains('parts')) return;

  const sessions = await getAllFromStore<Session>(targetDb, 'sessions');
  if (sessions.length === 0) {
    markPartsMigrationRun();
    return;
  }

  const parts = await getAllFromStore<Part>(targetDb, 'parts');
  const sessionsWithParts = new Set(parts.map(p => p.sessionId));
  const versions = await getAllFromStore<Version>(targetDb, 'versions');

  const newParts: Part[] = [];
  const versionUpdates: Version[] = [];
  const sessionUpdates: Session[] = [];

  for (const session of sessions) {
    if (sessionsWithParts.has(session.id)) continue;
    const partId = generateId();
    newParts.push({
      id: partId,
      sessionId: session.id,
      name: 'Object 1',
      order: 0,
      created: session.created,
      updated: session.updated,
    });
    for (const v of versions) {
      if (v.sessionId === session.id && !v.partId) {
        v.partId = partId;
        versionUpdates.push(v);
      }
    }
    if (!session.currentPartId) {
      session.currentPartId = partId;
      sessionUpdates.push(session);
    }
  }

  if (newParts.length === 0 && versionUpdates.length === 0 && sessionUpdates.length === 0) {
    markPartsMigrationRun();
    return;
  }

  const txn = targetDb.transaction(['sessions', 'versions', 'parts'], 'readwrite');
  for (const p of newParts) txn.objectStore('parts').put(p);
  for (const v of versionUpdates) txn.objectStore('versions').put(v);
  for (const s of sessionUpdates) txn.objectStore('sessions').put(s);
  await txComplete(txn);
  console.info(`Partwright: migrated ${newParts.length} session(s) to multi-part storage.`);
  markPartsMigrationRun();
}

// === Sessions ===

export async function createSession(name?: string, language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel'): Promise<Session> {
  const session: Session = {
    id: generateId(),
    name: name || `Session ${new Date().toLocaleDateString()}`,
    created: Date.now(),
    updated: Date.now(),
    ...(language && language !== 'manifold-js' ? { language } : {}),
  };
  const store = await tx('sessions', 'readwrite');
  store.put(session);
  await txComplete(store.transaction);
  return session;
}

// Legacy on-disk shape for images: an object map keyed by angle. Sessions
// stored before the array migration may still be in this form.
type LegacyImagesObject = Partial<Record<LegacyImageAngle, string>>;

type LegacyImagesShape = LegacyImagesObject | AttachedImage[] | null;

export async function getSession(id: string): Promise<Session | null> {
  const store = await tx('sessions', 'readonly');
  const raw = await reqToPromise(store.get(id)) as (Session & { images?: LegacyImagesShape; referenceImages?: LegacyImagesShape }) | null;
  return raw ? migrateSessionImages(raw) : null;
}

export async function listSessions(): Promise<Session[]> {
  const store = await tx('sessions', 'readonly');
  const sessions = await reqToPromise(store.getAll()) as (Session & { images?: LegacyImagesShape; referenceImages?: LegacyImagesShape })[];
  return sessions.map(migrateSessionImages).sort((a, b) => b.updated - a.updated);
}

// Read-time migration for legacy shapes, collapsing them all into the typed
// `attachments` array:
//  1. Pre-rename sessions stored data under `referenceImages`, then `images`.
//  2. Pre-array sessions stored an object map ({front: 'url', ...}) rather than an array.
//  3. Pre-unification sessions stored items as {id, angle, src, label?}; we collapse
//     `angle` into `label`.
//  4. Pre-attachments sessions stored `{id, src, label}` images with no `kind` —
//     we normalize each into a typed `kind: 'image'` attachment.
function migrateSessionImages(s: Session & { images?: LegacyImagesShape; referenceImages?: LegacyImagesShape }): Session {
  // Operate on an untyped view so we can hold both legacy and new shapes during migration.
  const raw = s as unknown as { attachments?: unknown; images?: unknown; referenceImages?: unknown };
  // Pick the first present source, newest field name first.
  let src: unknown = raw.attachments ?? raw.images ?? raw.referenceImages ?? null;
  delete raw.images;
  delete raw.referenceImages;
  if (src && !Array.isArray(src) && typeof src === 'object') {
    src = legacyImagesObjectToArray(src as LegacyImagesObject);
  }
  if (Array.isArray(src)) {
    raw.attachments = (src as Array<Record<string, unknown>>).map(item =>
      normalizeAttachment(
        {
          id: typeof item.id === 'string' ? item.id : undefined,
          src: typeof item.src === 'string' ? item.src : '',
          // Pre-unification rows tagged the angle; fold it into the label.
          label: collapseAngleIntoLabel(item),
          description: typeof item.description === 'string' ? item.description : undefined,
          kind: typeof item.kind === 'string' ? (item.kind as AttachmentKind) : undefined,
          mediaType: typeof item.mediaType === 'string' ? item.mediaType : undefined,
          addedAt: typeof item.addedAt === 'number' ? item.addedAt : undefined,
          source: item.source === 'chat' || item.source === 'user' ? item.source : undefined,
        },
        generateId(),
      ),
    );
  } else {
    raw.attachments = null;
  }
  return s;
}

/** Compute the effective label: explicit label wins, else the legacy
 *  `angle` field capitalized, else empty. */
function collapseAngleIntoLabel(item: Record<string, unknown>): string {
  const existingLabel = typeof item.label === 'string' ? item.label.trim() : '';
  if (existingLabel) return existingLabel;
  const angle = typeof item.angle === 'string' ? item.angle : '';
  return angle ? capitalize(angle) : '';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function legacyImagesObjectToArray(obj: LegacyImagesObject): SessionAttachment[] {
  const result: SessionAttachment[] = [];
  for (const angle of LEGACY_ANGLES) {
    const src = obj[angle];
    if (src) result.push(normalizeAttachment({ src, label: capitalize(angle), kind: 'image' }, generateId()));
  }
  return result;
}

export async function updateSession(id: string, updates: Partial<Pick<Session, 'name' | 'created' | 'updated' | 'attachments' | 'language' | 'currentPartId' | 'aiPreference' | 'thumbCamera' | 'workCamera'>>): Promise<void> {
  const store = await tx('sessions', 'readwrite');
  // Read-modify-write inside one transaction: queue the put from the get's
  // callback (awaiting between them risks auto-commit), then await oncomplete.
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const session = getReq.result as Session | null;
    if (!session) return;
    Object.assign(session, updates);
    // Strip legacy fields if present so they don't shadow the new one on re-read
    delete (session as { referenceImages?: unknown }).referenceImages;
    delete (session as { images?: unknown }).images;
    store.put(session);
  };
  await txComplete(store.transaction);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDB();
  // `drafts` only exists from v6 — guard so older deployments don't trip a
  // NotFoundError when the upgrade hasn't run yet.
  const stores = ['sessions', 'versions', 'notes', 'parts', 'aiChats'];
  if (db.objectStoreNames.contains('drafts')) stores.push('drafts');
  // `reliefSources` only exists from v7 — guard like `drafts` above.
  if (db.objectStoreNames.contains('reliefSources')) stores.push('reliefSources');
  // `deletedObjects` (the object bin) only exists from v9.
  if (db.objectStoreNames.contains('deletedObjects')) stores.push('deletedObjects');
  const txn = db.transaction(stores, 'readwrite');
  txn.objectStore('sessions').delete(id);
  // The relief source blob is keyed by sessionId, so a direct key delete clears
  // it (no index walk needed). No-op for non-relief sessions.
  if (db.objectStoreNames.contains('reliefSources')) txn.objectStore('reliefSources').delete(id);
  // Delete all versions, notes, parts, AI chat messages, and editor drafts
  // belonging to this session. Chats are keyed by id but indexed by sessionId,
  // so they're swept here too — otherwise the transcript is orphaned in
  // IndexedDB forever.
  const deleteByIndex = (storeName: string) => {
    const idx = txn.objectStore(storeName).index('sessionId');
    const req = idx.openCursor(IDBKeyRange.only(id));
    return new Promise<void>((resolve, reject) => {
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
  };
  const cascades: Promise<void>[] = [
    deleteByIndex('versions'),
    deleteByIndex('notes'),
    deleteByIndex('parts'),
    deleteByIndex('aiChats'),
  ];
  if (db.objectStoreNames.contains('drafts')) cascades.push(deleteByIndex('drafts'));
  if (db.objectStoreNames.contains('deletedObjects')) cascades.push(deleteByIndex('deletedObjects'));
  await Promise.all(cascades);
  // Wait for the entire transaction to commit
  await txComplete(txn);
}

// === Parts ===

export async function createPart(sessionId: string, name: string, order: number, group?: string): Promise<Part> {
  const part: Part = {
    id: generateId(),
    sessionId,
    name,
    order,
    ...(group && group.trim() ? { group: group.trim() } : {}),
    created: Date.now(),
    updated: Date.now(),
  };
  const store = await tx('parts', 'readwrite');
  store.put(part);
  await txComplete(store.transaction);
  return part;
}

export async function listParts(sessionId: string): Promise<Part[]> {
  const store = await tx('parts', 'readonly');
  const index = store.index('sessionId');
  const parts = await reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as Part[];
  return parts.sort((a, b) => a.order - b.order);
}

export async function updatePart(id: string, updates: Partial<Pick<Part, 'name' | 'order' | 'group' | 'updated'>>): Promise<void> {
  const store = await tx('parts', 'readwrite');
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const part = getReq.result as Part | null;
    if (!part) return;
    Object.assign(part, updates);
    // A blank/absent group means "ungrouped" — drop the field so the record
    // never carries an empty-string group that would read as a distinct group.
    if ('group' in updates && !(updates.group && updates.group.trim())) delete part.group;
    else if (part.group) part.group = part.group.trim();
    store.put(part);
  };
  await txComplete(store.transaction);
}

/** Apply a batch of part-order updates in a single transaction so a reorder is
 *  atomic — an interruption can't leave parts with duplicate/partial `order`
 *  values the way N separate transactions could. */
export async function updatePartOrders(updates: { id: string; order: number; group?: string | null }[]): Promise<void> {
  if (updates.length === 0) return;
  const store = await tx('parts', 'readwrite');
  const now = Date.now();
  for (const { id, order, group } of updates) {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const part = getReq.result as Part | null;
      if (!part) return;
      part.order = order;
      // `group` present (even null) reassigns membership; absent leaves it as-is
      // — so an order-only reorder never disturbs existing groups.
      if (group !== undefined) {
        if (group && group.trim()) part.group = group.trim();
        else delete part.group;
      }
      part.updated = now;
      store.put(part);
    };
  }
  await txComplete(store.transaction);
}

/** Assign (or clear, when `group` is null/blank) the group of several parts in
 *  a single transaction, so a multi-part group action either fully commits or
 *  fully rolls back. No-op for an empty list. */
export async function updatePartGroups(ids: string[], group: string | null): Promise<void> {
  if (ids.length === 0) return;
  const clean = group && group.trim() ? group.trim() : null;
  const store = await tx('parts', 'readwrite');
  const now = Date.now();
  for (const id of ids) {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const part = getReq.result as Part | null;
      if (!part) return;
      if (clean) part.group = clean; else delete part.group;
      part.updated = now;
      store.put(part);
    };
  }
  await txComplete(store.transaction);
}

// === Recently deleted objects (the bin) ===

/** An object moved to the bin: its part row plus everything that was deleted
 *  with it (versions + per-part editor drafts), kept verbatim so a restore puts
 *  back exactly what was there — ids, version indices and unsaved work. The
 *  versions are in their stored form (big arrays as Blobs, see
 *  {@link storedVersion}). */
export interface DeletedObject {
  /** The deleted part's id (an object can only be in the bin once). */
  id: string;
  sessionId: string;
  part: Part;
  versions: Version[];
  drafts: SessionDraft[];
  deletedAt: number;
}

/**
 * Move several parts into the bin in one transaction: each part's row, its
 * versions and its drafts become one {@link DeletedObject} entry and are removed
 * from the live stores, so every reader of parts/versions keeps working
 * unchanged. Requests are chained from callbacks (no awaits mid-transaction).
 * No-op for an empty list or ids that don't exist.
 */
export async function trashParts(ids: string[], deletedAt: number = Date.now()): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  const txn = db.transaction(['parts', 'versions', 'drafts', 'deletedObjects'], 'readwrite');
  const partStore = txn.objectStore('parts');
  const versionStore = txn.objectStore('versions');
  const draftStore = txn.objectStore('drafts');
  const bin = txn.objectStore('deletedObjects');
  for (const id of ids) {
    const partReq = partStore.get(id);
    partReq.onsuccess = () => {
      const part = partReq.result as Part | undefined;
      if (!part) return;
      const vReq = versionStore.index('partId').getAll(IDBKeyRange.only(id));
      vReq.onsuccess = () => {
        const versions = vReq.result as Version[];
        const dReq = draftStore.index('sessionId').getAll(IDBKeyRange.only(part.sessionId));
        dReq.onsuccess = () => {
          const prefix = `${part.sessionId}:${id}:`;
          const drafts = (dReq.result as SessionDraft[]).filter(d => d.id.startsWith(prefix));
          const entry: DeletedObject = { id, sessionId: part.sessionId, part, versions, drafts, deletedAt };
          bin.put(entry);
          partStore.delete(id);
          for (const v of versions) versionStore.delete(v.id);
          for (const d of drafts) draftStore.delete(d.id);
        };
      };
    };
  }
  await txComplete(txn);
}

/** How many bin entries of one session were deleted at or after `since` — a
 *  key-only index count, so the rail's badge never loads the entries' versions. */
export async function countDeletedObjects(sessionId: string, since: number): Promise<number> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('deletedObjects')) return 0;
  const store = await tx('deletedObjects', 'readonly');
  return reqToPromise(store.index('sessionId_deletedAt').count(IDBKeyRange.bound([sessionId, since], [sessionId, Infinity])));
}

/** Permanently delete parts and their versions + drafts (no bin) — the
 *  fallback when moving them to the bin would exceed the storage quota. */
export async function hardDeleteParts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  const txn = db.transaction(['parts', 'versions', 'drafts'], 'readwrite');
  const partStore = txn.objectStore('parts');
  const versionStore = txn.objectStore('versions');
  const draftStore = txn.objectStore('drafts');
  for (const id of ids) {
    const partReq = partStore.get(id);
    partReq.onsuccess = () => {
      const part = partReq.result as Part | undefined;
      if (!part) return;
      partStore.delete(id);
      const vReq = versionStore.index('partId').getAllKeys(IDBKeyRange.only(id));
      vReq.onsuccess = () => { for (const k of vReq.result) versionStore.delete(k); };
      const dReq = draftStore.index('sessionId').getAllKeys(IDBKeyRange.only(part.sessionId));
      dReq.onsuccess = () => {
        const prefix = `${part.sessionId}:${id}:`;
        for (const k of dReq.result) if (String(k).startsWith(prefix)) draftStore.delete(k);
      };
    };
  }
  await txComplete(txn);
}

/** The bin entries for one session, newest first. */
export async function listDeletedObjects(sessionId: string): Promise<DeletedObject[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('deletedObjects')) return [];
  const store = await tx('deletedObjects', 'readonly');
  const rows = await reqToPromise(store.index('sessionId').getAll(IDBKeyRange.only(sessionId))) as DeletedObject[];
  return rows.sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * Move bin entries back into the live stores in one transaction — the part row
 * (with `order` overridden per `orders` when given), its versions and drafts,
 * verbatim — and drop the entries. Returns the restored parts; ids not in the
 * bin are skipped.
 */
export async function untrashParts(ids: string[], orders: Map<string, number> = new Map()): Promise<Part[]> {
  if (ids.length === 0) return [];
  const db = await openDB();
  const txn = db.transaction(['parts', 'versions', 'drafts', 'deletedObjects'], 'readwrite');
  const bin = txn.objectStore('deletedObjects');
  const restored: Part[] = [];
  for (const id of ids) {
    const req = bin.get(id);
    req.onsuccess = () => {
      const entry = req.result as DeletedObject | undefined;
      if (!entry) return;
      const order = orders.get(id);
      const part: Part = order === undefined ? entry.part : { ...entry.part, order };
      txn.objectStore('parts').put(part);
      for (const v of entry.versions) txn.objectStore('versions').put(v);
      for (const d of entry.drafts) txn.objectStore('drafts').put(d);
      bin.delete(id);
      restored.push(part);
    };
  }
  await txComplete(txn);
  return restored;
}

/** Permanently delete bin entries (by part id). */
export async function purgeDeletedObjects(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const store = await tx('deletedObjects', 'readwrite');
  for (const id of ids) store.delete(id);
  await txComplete(store.transaction);
}

// === Versions ===

export interface SaveVersionOptions {
  label?: string;
  notes?: string;
  /** Override the version timestamp (used by import to preserve the original). */
  timestamp?: number;
  /** Snapshot of annotations at save time (opaque to the db layer). */
  annotations?: unknown[];
  /** External meshes imported into this version (opaque to the db layer). */
  importedMeshes?: unknown[];
  /** Modeling language the version was authored in. Stored on the version so
   *  navigating between versions can swap the engine independently of the
   *  session's default language. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  /** Customizer parameter overrides for this version (opaque to the db layer). */
  paramValues?: Record<string, number | boolean | string>;
  /** Companion SCAD files (path → source) for this version (opaque to the db layer). */
  companionFiles?: Record<string, string>;
  /** The version this was derived from (e.g. the parametric version before
   *  simplify/enhance was applied). Stored so the UI can show provenance and
   *  offer a one-click jump back to the source. */
  parentVersionId?: string | null;
  /** The operation that produced this version. */
  operation?: VersionOperation | null;
  /** Computed `api.surface.*` texture (key + mesh) — see {@link Version.surfaceTexture}. */
  surfaceTexture?: unknown;
  /** App semver that authored this version — see {@link Version.appVersion}.
   *  Caller passes `buildInfo.version` (omit/undefined in dev where it's
   *  'unknown'); the db layer just stores it opaquely. */
  appVersion?: string;
  /** Geometry fingerprint — see {@link Version.fingerprint}. */
  fingerprint?: unknown;
  /** Displayed mesh — see {@link Version.latestMesh}. Saving any version drops
   *  the part's previous newest version's copy, whether or not this one has one. */
  latestMesh?: unknown;
}

export async function saveVersion(
  partId: string,
  sessionId: string,
  code: string,
  geometryData: Record<string, unknown> | null,
  thumbnail: Blob | null,
  options?: SaveVersionOptions,
): Promise<Version> {
  const {
    label,
    notes,
    timestamp,
    annotations,
    importedMeshes,
    language,
    paramValues,
    companionFiles,
    parentVersionId,
    operation,
    surfaceTexture,
    appVersion,
    fingerprint,
    latestMesh,
  } = options ?? {};
  // Compute the next index and write the version inside ONE readwrite
  // transaction. IndexedDB serializes overlapping readwrite transactions on
  // the same store (even across tabs), so two tabs saving to the same part
  // concurrently can't both mint the same index and trip the unique
  // `partId_index` constraint. A reverse key-cursor on the compound index reads
  // just the highest [partId, index] key — no heavy geometry/thumbnail blobs.
  // (Note: IDBIndex.getAllKeys returns *primary* keys, not index keys, so a
  // cursor is required to read the index value.) Indices are per-part, so we
  // scan the partId compound index, not sessionId.
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  const store = txn.objectStore('versions');
  const version = await new Promise<Version>((resolve, reject) => {
    const cursorReq = store.index('partId_index').openKeyCursor(
      IDBKeyRange.bound([partId], [partId, []]),
      'prev',
    );
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      const maxIndex = cursor ? (cursor.key as [string, number])[1] : 0;
      // The part's newest version so far: the only one that can hold a
      // latestMesh (see Version.latestMesh). This save supersedes it.
      const prevNewestId = cursor ? cursor.primaryKey as string : null;
      const nextIndex = maxIndex + 1;
      const v: Version = {
        id: generateId(),
        sessionId,
        partId,
        index: nextIndex,
        code,
        geometryData,
        thumbnail,
        label: label || `v${nextIndex}`,
        timestamp: timestamp ?? Date.now(),
        ...(notes ? { notes } : {}),
        ...(language ? { language } : {}),
        ...(annotations && annotations.length > 0 ? { annotations } : {}),
        ...(importedMeshes && importedMeshes.length > 0 ? { importedMeshes } : {}),
        ...(paramValues && Object.keys(paramValues).length > 0 ? { paramValues } : {}),
        ...(companionFiles && Object.keys(companionFiles).length > 0 ? { companionFiles } : {}),
        ...(parentVersionId ? { parentVersionId } : {}),
        ...(operation ? { operation } : {}),
        ...(surfaceTexture ? { surfaceTexture } : {}),
        ...(appVersion ? { appVersion } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(latestMesh ? { latestMesh } : {}),
      };
      const putReq = store.put(storedVersion(v));
      putReq.onsuccess = () => {
        resolve(v);
        // Drop the superseded newest version's mesh in the same transaction,
        // chained from callbacks (an await here would let it auto-commit).
        if (!prevNewestId) return;
        const getReq = store.get(prevNewestId);
        getReq.onsuccess = () => {
          const prev = getReq.result as Version | undefined;
          if (!prev || prev.latestMesh === undefined) return;
          const { latestMesh: _dropped, ...rest } = prev;
          store.put(rest);
        };
      };
      putReq.onerror = () => reject(putReq.error);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  await txComplete(txn);

  // Bump part.updated and session.updated unless the caller is restoring an
  // earlier timestamp (an import that wants to preserve original timestamps
  // will restore them after).
  const stamp = timestamp ?? Date.now();
  await updatePart(partId, { updated: stamp });
  await updateSession(sessionId, { updated: stamp });

  return version;
}

/** List a part's versions (its own v1, v2, … sequence), sorted by index. */
export async function listVersions(partId: string): Promise<Version[]> {
  const store = await tx('versions', 'readonly');
  const index = store.index('partId');
  const versions = await reqToPromise(index.getAll(IDBKeyRange.only(partId))) as Version[];
  await Promise.all(versions.map(v => loadedVersion(v)));
  return versions.sort((a, b) => a.index - b.index);
}

export async function getLatestVersion(partId: string): Promise<Version | null> {
  const versions = await listVersions(partId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export async function getVersionByIndex(partId: string, index: number): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  const idx = store.index('partId_index');
  return loadedVersion(await reqToPromise(idx.get([partId, index])) as Version | undefined);
}

export async function getVersionById(id: string): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  return loadedVersion(await reqToPromise(store.get(id)) as Version | undefined);
}

export async function getVersionCount(partId: string): Promise<number> {
  const store = await tx('versions', 'readonly');
  const index = store.index('partId');
  return reqToPromise(index.count(IDBKeyRange.only(partId)));
}

// === Session-scoped version helpers (aggregate across all parts) ===
// Used by the recent-session grids (landing, session list) and empty-session
// cleanup, which think in terms of whole sessions rather than individual parts.

export async function getSessionVersionCount(sessionId: string): Promise<number> {
  const store = await tx('versions', 'readonly');
  const index = store.index('sessionId');
  return reqToPromise(index.count(IDBKeyRange.only(sessionId)));
}

/** The most recently saved version across all of a session's parts — a
 *  representative record for thumbnails/labels in session grids. */
export async function getSessionLatestVersion(sessionId: string): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  const index = store.index('sessionId');
  const versions = await reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as Version[];
  if (versions.length === 0) return null;
  return loadedVersion(versions.reduce((latest, v) => (v.timestamp > latest.timestamp ? v : latest)));
}

/** The mesh imports (file name + triangle count, the import's id and the
 *  object holding it) any version of the session holds — what a multi-file
 *  import checks to skip models that are already in. Every version counts, so
 *  an object later converted to code still shows its import. Read from the
 *  stored records without unpacking, so no mesh data is loaded. */
export async function listSessionImportSignatures(sessionId: string): Promise<{ filename: string; numTri: number; id?: string; partId: string }[]> {
  const store = await tx('versions', 'readonly');
  const versions = await reqToPromise(store.index('sessionId').getAll(IDBKeyRange.only(sessionId))) as Version[];
  const out: { filename: string; numTri: number; id?: string; partId: string }[] = [];
  for (const v of versions) {
    for (const m of v.importedMeshes ?? []) {
      const { filename, numTri, id } = (m ?? {}) as { filename?: unknown; numTri?: unknown; id?: unknown };
      if (typeof filename === 'string' && typeof numTri === 'number') {
        out.push({ filename, numTri, ...(typeof id === 'string' ? { id } : {}), partId: v.partId });
      }
    }
  }
  return out;
}

export async function deleteVersion(id: string): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  txn.objectStore('versions').delete(id);
  await txComplete(txn);
}

/** Overwrite a single version's thumbnail blob, leaving every other field
 *  intact. Used by the import-time thumbnail backfill: imported versions are
 *  persisted with no thumbnail so the new session can be selected immediately,
 *  then each snapshot is rendered offscreen afterwards and written back here.
 *  No-op when the version no longer exists (e.g. session deleted mid-backfill). */
export async function updateVersionThumbnail(id: string, thumbnail: Blob | null): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  const store = txn.objectStore('versions');
  // Read then write inside the same request chain — never await between the get
  // and the put, or IndexedDB auto-commits the transaction first.
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const v = getReq.result as Version | null;
    if (v) {
      v.thumbnail = thumbnail;
      store.put(v);
    }
  };
  await txComplete(txn);
}

/** Overwrite a version's Customizer parameter overrides. Used by the Assembly
 *  view's shared-parameter Save, which writes the tweaked values back to every
 *  affected part's latest version. Empty/undefined clears the field. */
export async function updateVersionParamValues(
  id: string,
  paramValues: Record<string, number | boolean | string> | undefined,
): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  const store = txn.objectStore('versions');
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const v = getReq.result as Version | null;
    if (v) {
      if (paramValues && Object.keys(paramValues).length > 0) v.paramValues = paramValues;
      else delete v.paramValues;
      store.put(v);
    }
  };
  await txComplete(txn);
}

/** Find all versions in a part whose parentVersionId points to the given id.
 *  Used to warn the user before deleting a version that other versions depend on. */
export async function findVersionChildren(parentId: string, partId: string): Promise<Version[]> {
  const versions = await listVersions(partId);
  return versions.filter(v => v.parentVersionId === parentId);
}

/** Clear the parentVersionId field on all versions that reference the given id.
 *  Called after the user confirms deletion of a parent version. */
export async function clearVersionParentRefs(parentId: string, partId: string): Promise<void> {
  const children = await findVersionChildren(parentId, partId);
  if (children.length === 0) return;
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  const store = txn.objectStore('versions');
  // Chain all reads and writes without awaiting between them inside the transaction.
  let pending = children.length;
  await new Promise<void>((resolve, reject) => {
    for (const child of children) {
      const getReq = store.get(child.id);
      getReq.onsuccess = () => {
        const v = getReq.result as Version | null;
        if (v) {
          v.parentVersionId = null;
          store.put(v);
        }
        if (--pending === 0) resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    }
  });
  await txComplete(txn);
}

/** Insert a version record verbatim, preserving its id, index, and timestamp.
 *  Used to restore a version that was deleted in the same session (undo). */
export async function putVersion(version: Version): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  txn.objectStore('versions').put(storedVersion(version));
  await txComplete(txn);
}

/** Rename a version (changes its display label only; index is immutable). */
export async function renameVersion(id: string, label: string): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  const store = txn.objectStore('versions');
  // Read-modify-write inside one transaction: queue the put from the get's
  // callback (awaiting between them risks auto-commit), then await oncomplete.
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const version = getReq.result as Version | null;
    if (!version) return;
    version.label = label;
    store.put(version);
  };
  await txComplete(txn);
}

// === Notes ===

export async function addNote(sessionId: string, text: string): Promise<SessionNote> {
  const note: SessionNote = {
    id: generateId(),
    sessionId,
    text,
    timestamp: Date.now(),
  };
  const store = await tx('notes', 'readwrite');
  store.put(note);
  await txComplete(store.transaction);
  await updateSession(sessionId, { updated: Date.now() });
  return note;
}

export async function listNotes(sessionId: string): Promise<SessionNote[]> {
  const store = await tx('notes', 'readonly');
  const index = store.index('sessionId');
  const notes = await reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as SessionNote[];
  return notes.sort((a, b) => a.timestamp - b.timestamp);
}

export async function deleteNote(id: string): Promise<void> {
  const store = await tx('notes', 'readwrite');
  store.delete(id);
  await txComplete(store.transaction);
}

export async function updateNote(id: string, text: string): Promise<void> {
  const store = await tx('notes', 'readwrite');
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const note = getReq.result as SessionNote | null;
    if (!note) return;
    note.text = text;
    note.timestamp = Date.now();
    store.put(note);
  };
  await txComplete(store.transaction);
}

// === Database reset ===

export async function clearAllData(): Promise<void> {
  const db = await openDB();
  const stores = ['sessions', 'versions', 'notes', 'parts', 'aiChats'];
  if (db.objectStoreNames.contains('drafts')) stores.push('drafts');
  if (db.objectStoreNames.contains('reliefSources')) stores.push('reliefSources');
  if (db.objectStoreNames.contains('deletedObjects')) stores.push('deletedObjects');
  if (db.objectStoreNames.contains('paintRefineCache')) stores.push('paintRefineCache');
  const txn = db.transaction(stores, 'readwrite');
  if (db.objectStoreNames.contains('paintRefineCache')) txn.objectStore('paintRefineCache').clear();
  txn.objectStore('sessions').clear();
  txn.objectStore('versions').clear();
  txn.objectStore('notes').clear();
  txn.objectStore('parts').clear();
  // Session-scoped AI transcripts go too; saved API keys (aiKeys) and the
  // global recent-image cache (aiAttachments) are not session data and are
  // left for the Uninstall modal's per-category wipe.
  txn.objectStore('aiChats').clear();
  if (db.objectStoreNames.contains('drafts')) txn.objectStore('drafts').clear();
  if (db.objectStoreNames.contains('reliefSources')) txn.objectStore('reliefSources').clear();
  if (db.objectStoreNames.contains('deletedObjects')) txn.objectStore('deletedObjects').clear();
  await txComplete(txn);
}

// === Editor drafts (per session, per part, per language) ===

export async function getDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel', partId?: string): Promise<SessionDraft | null> {
  const store = await tx('drafts', 'readonly');
  return reqToPromise(store.get(draftId(sessionId, language, partId))) as Promise<SessionDraft | null>;
}

export async function setDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel', code: string, partId?: string, companionFiles?: Record<string, string>, colorRegions?: unknown[]): Promise<void> {
  const store = await tx('drafts', 'readwrite');
  const row: SessionDraft = {
    id: draftId(sessionId, language, partId),
    sessionId,
    language,
    code,
    ...(companionFiles && Object.keys(companionFiles).length > 0 ? { companionFiles } : {}),
    ...(colorRegions && colorRegions.length > 0 ? { colorRegions } : {}),
    updatedAt: Date.now(),
  };
  store.put(row);
  await txComplete(store.transaction);
}


export async function listDrafts(sessionId: string): Promise<SessionDraft[]> {
  const store = await tx('drafts', 'readonly');
  const index = store.index('sessionId');
  return reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as Promise<SessionDraft[]>;
}

/** Delete the working buffer for a single (session, part, language) triple.
 *  Called after a version is saved so a now-superseded draft can't shadow the
 *  freshly-saved code on the next reload. No-ops when no such draft exists. */
export async function deleteDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel', partId?: string): Promise<void> {
  const store = await tx('drafts', 'readwrite');
  store.delete(draftId(sessionId, language, partId));
  await txComplete(store.transaction);
}

// === Relief source images (per session) ===

/** The original image/SVG a relief session was generated from, kept so the
 *  import wizard can be reopened pre-loaded with the source (no re-upload).
 *  Keyed by sessionId. Cascade-deleted in {@link deleteSession}. */
export interface ReliefSourceRecord {
  sessionId: string;
  blob: Blob;
  filename: string;
  /** True when the source was an SVG (the wizard routes SVGs differently). */
  isSvg: boolean;
  timestamp: number;
}

export async function getReliefSourceRecord(sessionId: string): Promise<ReliefSourceRecord | null> {
  const db = await openDB();
  // Store only exists from v7 — older connections shouldn't throw.
  if (!db.objectStoreNames.contains('reliefSources')) return null;
  const store = db.transaction('reliefSources', 'readonly').objectStore('reliefSources');
  return (await reqToPromise(store.get(sessionId)) as ReliefSourceRecord | undefined) ?? null;
}

export async function setReliefSourceRecord(record: ReliefSourceRecord): Promise<void> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('reliefSources')) return;
  const txn = db.transaction('reliefSources', 'readwrite');
  txn.objectStore('reliefSources').put(record);
  await txComplete(txn);
}


// === Recent-imports / recent-exports inboxes (persisted ring buffers) ===
//
// Storage primitives for the import/export inboxes. The ring-buffer semantics
// (dedupe, newest-first ordering, 10-entry cap) live in the inbox modules;
// db.ts only mirrors the resulting mutations to IndexedDB so the lists survive
// a refresh. Records are stored by their `id` and carry a Blob (structured-
// clone handles it). Stores only exist from v8, so every accessor guards on
// `objectStoreNames.contains` like the v7 reliefSources accessors above.

export type InboxStore = 'importInbox' | 'exportInbox';

/** All persisted entries for an inbox, used to rehydrate the in-memory buffer
 *  on boot. Order isn't guaranteed by IndexedDB; the caller re-sorts. */
export async function getInboxRecords<T>(store: InboxStore): Promise<T[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains(store)) return [];
  const txn = db.transaction(store, 'readonly');
  const records = await reqToPromise(txn.objectStore(store).getAll()) as T[];
  await txComplete(txn);
  return records;
}

/** Apply one ring-buffer mutation in a single transaction: drop the ids evicted
 *  by a dedupe or overflow, then put the freshly-added entry. */
export async function applyInboxMutation<T extends { id: string }>(
  store: InboxStore,
  put: T | null,
  deleteIds: string[],
): Promise<void> {
  const db = await openDB();
  if (!db.objectStoreNames.contains(store)) return;
  const txn = db.transaction(store, 'readwrite');
  const os = txn.objectStore(store);
  for (const id of deleteIds) os.delete(id);
  if (put) os.put(put);
  await txComplete(txn);
}

/** Empty an inbox store (backs the toolbar's "Clear" action). */
export async function clearInboxStore(store: InboxStore): Promise<void> {
  const db = await openDB();
  if (!db.objectStoreNames.contains(store)) return;
  const txn = db.transaction(store, 'readwrite');
  txn.objectStore(store).clear();
  await txComplete(txn);
}

// === Smooth-paint refined-mesh cache (v9) ===
//
// Content-keyed, local-only, best-effort. Entries are evicted least-recently-
// used first down to a total-bytes budget. Nothing references them, so a
// deleted session's entries simply age out through the same LRU (clearAllData
// and the Data-tab wipe clear the store outright).

export interface PaintRefineCacheEntry {
  key: string;
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number; numProp: number };
  /** Source triangle on the base mesh, per refined triangle. */
  toRoot: Int32Array;
  /** Buffer bytes (vertProperties + triVerts + toRoot) — the eviction weight. */
  bytes: number;
  /** ms epoch of the last write or (coarse) read. */
  lastUsed: number;
}

/** Look a refined mesh up by content key. A hit whose `lastUsed` is older
 *  than `touchAfterMs` is re-stamped (that rewrites the row, so reads only
 *  touch it occasionally). Never throws: any failure reads as a miss. */
export async function getPaintRefineCache(key: string, touchAfterMs: number): Promise<PaintRefineCacheEntry | null> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('paintRefineCache')) return null;
    const txn = db.transaction('paintRefineCache', 'readwrite');
    const store = txn.objectStore('paintRefineCache');
    let hit: PaintRefineCacheEntry | null = null;
    const req = store.get(key);
    req.onsuccess = () => {
      const row = req.result as PaintRefineCacheEntry | undefined;
      if (!row) return;
      hit = row;
      const now = Date.now();
      // Chained from the get's callback — no await between get and put.
      if (now - row.lastUsed > touchAfterMs) store.put({ ...row, lastUsed: now });
    };
    await txComplete(txn);
    return hit;
  } catch {
    return null;
  }
}

/** Cache a refined mesh, then evict least-recently-used entries until the
 *  store fits `maxTotalBytes`. Its own transaction, best-effort: returns
 *  false (and caches nothing) when the entry alone is over budget or the
 *  write fails (e.g. QuotaExceededError) — never throws. */
export async function putPaintRefineCache(
  entry: Omit<PaintRefineCacheEntry, 'bytes' | 'lastUsed'>,
  maxTotalBytes: number,
): Promise<boolean> {
  const bytes = entry.mesh.vertProperties.byteLength + entry.mesh.triVerts.byteLength + entry.toRoot.byteLength;
  if (bytes > maxTotalBytes) return false;
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('paintRefineCache')) return false;
    const txn = db.transaction('paintRefineCache', 'readwrite');
    const store = txn.objectStore('paintRefineCache');
    const row: PaintRefineCacheEntry = { ...entry, bytes, lastUsed: Date.now() };
    const putReq = store.put(row);
    putReq.onsuccess = () => {
      // Newest first: keep entries while they fit, delete the older rest.
      let total = 0;
      const cur = store.index('lastUsed_bytes').openKeyCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        total += (c.key as [number, number])[1];
        if (total > maxTotalBytes) store.delete(c.primaryKey);
        c.continue();
      };
    };
    await txComplete(txn);
    return true;
  } catch {
    return false;
  }
}
