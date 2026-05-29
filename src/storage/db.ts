// IndexedDB storage for sessions and versions

export interface Session {
  id: string;
  name: string;
  created: number;
  updated: number;
  images?: AttachedImage[] | null;
  /** Modeling language for this session. Missing = 'manifold-js'. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  /** Id of the part that is active when the session is (re)opened. Missing =
   *  fall back to the first part by `order`. Set on every part switch so the
   *  editor restores to the part the user last worked on. */
  currentPartId?: string;
  /** Last-used AI provider + model for this session, restored when the session
   *  is reopened so each session remembers which assistant was driving it.
   *  Plain strings to keep the storage layer decoupled from the AI types. */
  aiPreference?: { provider: string; model: string };
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
  created: number;
  updated: number;
}

export interface AttachedImage {
  id: string;
  /** data URL or remote URL */
  src: string;
  /** User-facing caption. Shown in the Gallery, lightbox, and tooltips.
   *  May match one of the preset labels (Front, Right, Back, Left, Top,
   *  Perspective) — those drive ordering of the image strip — or be
   *  a free-form custom string. Empty string and undefined both mean
   *  "no caption". */
  label?: string;
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
}

/** Editor working buffer scoped to (session, language). One per language per
 *  session: switching the toolbar's language toggle stashes the previous
 *  language's code here and restores the target language's. Persisted so a
 *  reload doesn't lose in-progress work in either language. Cascade-deleted
 *  with the session. */
export interface SessionDraft {
  /** Composite key: `${sessionId}:${language}`. Lets the cascade delete on
   *  session removal walk a simple `sessionId` index. */
  id: string;
  sessionId: string;
  language: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
  code: string;
  updatedAt: number;
}

function draftId(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel'): string {
  return `${sessionId}:${language}`;
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
const DB_VERSION = 6;

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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
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
      name: 'Part 1',
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

export async function getSession(id: string): Promise<Session | null> {
  const store = await tx('sessions', 'readonly');
  const raw = await reqToPromise(store.get(id)) as (Session & { referenceImages?: LegacyImagesObject | AttachedImage[] | null }) | null;
  return raw ? migrateSessionImages(raw) : null;
}

export async function listSessions(): Promise<Session[]> {
  const store = await tx('sessions', 'readonly');
  const sessions = await reqToPromise(store.getAll()) as (Session & { referenceImages?: LegacyImagesObject | AttachedImage[] | null })[];
  return sessions.map(migrateSessionImages).sort((a, b) => b.updated - a.updated);
}

// Read-time migration for three legacy shapes:
//  1. Pre-rename sessions stored data under `referenceImages` instead of `images`.
//  2. Pre-array sessions stored an object map ({front: 'url', ...}) rather than an array.
//  3. Pre-unification sessions stored items as {id, angle, src, label?}; we collapse
//     `angle` into `label` here so callers see a single user-facing field.
function migrateSessionImages(s: Session & { referenceImages?: LegacyImagesObject | AttachedImage[] | null }): Session {
  // Operate on an untyped view so we can hold both legacy and new shapes during migration.
  const raw = s as unknown as { images?: unknown; referenceImages?: unknown };
  if (raw.images == null && raw.referenceImages != null) {
    raw.images = raw.referenceImages;
  }
  delete raw.referenceImages;
  if (raw.images && !Array.isArray(raw.images) && typeof raw.images === 'object') {
    raw.images = legacyImagesObjectToArray(raw.images as LegacyImagesObject);
  }
  if (Array.isArray(raw.images)) {
    raw.images = (raw.images as Array<Record<string, unknown>>).map(collapseAngleIntoLabel);
  }
  return s;
}

/** Drop the legacy `angle` field, copying it into `label` (capitalized) when
 *  a label isn't already present. After this, `label` is the single source of
 *  truth for how the image is named in the UI. */
function collapseAngleIntoLabel(item: Record<string, unknown>): AttachedImage {
  const id = typeof item.id === 'string' ? item.id : generateId();
  const src = typeof item.src === 'string' ? item.src : '';
  const existingLabel = typeof item.label === 'string' ? item.label.trim() : '';
  const angle = typeof item.angle === 'string' ? item.angle : '';
  const out: AttachedImage = { id, src };
  const label = existingLabel || (angle ? capitalize(angle) : '');
  if (label) out.label = label;
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function legacyImagesObjectToArray(obj: LegacyImagesObject): AttachedImage[] {
  const result: AttachedImage[] = [];
  for (const angle of LEGACY_ANGLES) {
    const src = obj[angle];
    if (src) result.push({ id: generateId(), src, label: capitalize(angle) });
  }
  return result;
}

export async function updateSession(id: string, updates: Partial<Pick<Session, 'name' | 'created' | 'updated' | 'images' | 'language' | 'currentPartId' | 'aiPreference'>>): Promise<void> {
  const store = await tx('sessions', 'readwrite');
  // Read-modify-write inside one transaction: queue the put from the get's
  // callback (awaiting between them risks auto-commit), then await oncomplete.
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const session = getReq.result as Session | null;
    if (!session) return;
    Object.assign(session, updates);
    // Strip legacy field if present so it doesn't shadow the new one on re-read
    delete (session as { referenceImages?: unknown }).referenceImages;
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
  const txn = db.transaction(stores, 'readwrite');
  txn.objectStore('sessions').delete(id);
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
  await Promise.all(cascades);
  // Wait for the entire transaction to commit
  await txComplete(txn);
}

// === Parts ===

export async function createPart(sessionId: string, name: string, order: number): Promise<Part> {
  const part: Part = {
    id: generateId(),
    sessionId,
    name,
    order,
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

export async function updatePart(id: string, updates: Partial<Pick<Part, 'name' | 'order' | 'updated'>>): Promise<void> {
  const store = await tx('parts', 'readwrite');
  const getReq = store.get(id);
  getReq.onsuccess = () => {
    const part = getReq.result as Part | null;
    if (!part) return;
    Object.assign(part, updates);
    store.put(part);
  };
  await txComplete(store.transaction);
}

/** Apply a batch of part-order updates in a single transaction so a reorder is
 *  atomic — an interruption can't leave parts with duplicate/partial `order`
 *  values the way N separate transactions could. */
export async function updatePartOrders(updates: { id: string; order: number }[]): Promise<void> {
  if (updates.length === 0) return;
  const store = await tx('parts', 'readwrite');
  const now = Date.now();
  for (const { id, order } of updates) {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const part = getReq.result as Part | null;
      if (!part) return;
      part.order = order;
      part.updated = now;
      store.put(part);
    };
  }
  await txComplete(store.transaction);
}

export async function deletePart(id: string): Promise<void> {
  await deleteParts([id]);
}

/**
 * Delete several parts (and cascade-delete their versions) atomically in a
 * single transaction, so a multi-select bulk delete either fully commits or
 * fully rolls back. No-op for an empty list.
 */
export async function deleteParts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  const txn = db.transaction(['parts', 'versions'], 'readwrite');
  const partStore = txn.objectStore('parts');
  const vIdx = txn.objectStore('versions').index('partId');
  for (const id of ids) {
    partStore.delete(id);
    // Cascade-delete the part's versions. Awaiting each cursor keeps the shared
    // transaction alive (its requests resolve in the IDB callbacks above).
    await new Promise<void>((resolve, reject) => {
      const vReq = vIdx.openCursor(IDBKeyRange.only(id));
      vReq.onsuccess = () => {
        const cursor = vReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      vReq.onerror = () => reject(vReq.error);
    });
  }
  await txComplete(txn);
}

// === Versions ===

export async function saveVersion(
  partId: string,
  sessionId: string,
  code: string,
  geometryData: Record<string, unknown> | null,
  thumbnail: Blob | null,
  label?: string,
  notes?: string,
  /** Override the version timestamp (used by import to preserve the original). */
  timestamp?: number,
  /** Snapshot of annotations at save time (opaque to the db layer). */
  annotations?: unknown[],
  /** External meshes imported into this version (opaque to the db layer). */
  importedMeshes?: unknown[],
  /** Modeling language the version was authored in. Stored on the version so
   *  navigating between versions can swap the engine independently of the
   *  session's default language. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel',
): Promise<Version> {
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
      };
      const putReq = store.put(v);
      putReq.onsuccess = () => resolve(v);
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
  return versions.sort((a, b) => a.index - b.index);
}

export async function getLatestVersion(partId: string): Promise<Version | null> {
  const versions = await listVersions(partId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export async function getVersionByIndex(partId: string, index: number): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  const idx = store.index('partId_index');
  return reqToPromise(idx.get([partId, index])) as Promise<Version | null>;
}

export async function getVersionById(id: string): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  return reqToPromise(store.get(id)) as Promise<Version | null>;
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
  return versions.reduce((latest, v) => (v.timestamp > latest.timestamp ? v : latest));
}

export async function deleteVersion(id: string): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  txn.objectStore('versions').delete(id);
  await txComplete(txn);
}

/** Insert a version record verbatim, preserving its id, index, and timestamp.
 *  Used to restore a version that was deleted in the same session (undo). */
export async function putVersion(version: Version): Promise<void> {
  const db = await openDB();
  const txn = db.transaction('versions', 'readwrite');
  txn.objectStore('versions').put(version);
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
  const txn = db.transaction(stores, 'readwrite');
  txn.objectStore('sessions').clear();
  txn.objectStore('versions').clear();
  txn.objectStore('notes').clear();
  txn.objectStore('parts').clear();
  // Session-scoped AI transcripts go too; saved API keys (aiKeys) and the
  // global recent-image cache (aiAttachments) are not session data and are
  // left for the Uninstall modal's per-category wipe.
  txn.objectStore('aiChats').clear();
  if (db.objectStoreNames.contains('drafts')) txn.objectStore('drafts').clear();
  await txComplete(txn);
}

// === Editor drafts (per session, per language) ===

export async function getDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel'): Promise<SessionDraft | null> {
  const store = await tx('drafts', 'readonly');
  return reqToPromise(store.get(draftId(sessionId, language))) as Promise<SessionDraft | null>;
}

export async function setDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel', code: string): Promise<void> {
  const store = await tx('drafts', 'readwrite');
  const row: SessionDraft = {
    id: draftId(sessionId, language),
    sessionId,
    language,
    code,
    updatedAt: Date.now(),
  };
  store.put(row);
  await txComplete(store.transaction);
}

export async function deleteDraft(sessionId: string, language: 'manifold-js' | 'scad' | 'replicad' | 'voxel'): Promise<void> {
  const store = await tx('drafts', 'readwrite');
  store.delete(draftId(sessionId, language));
  await txComplete(store.transaction);
}

export async function listDrafts(sessionId: string): Promise<SessionDraft[]> {
  const store = await tx('drafts', 'readonly');
  const index = store.index('sessionId');
  return reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as Promise<SessionDraft[]>;
}
