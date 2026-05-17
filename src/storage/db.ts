// IndexedDB storage for sessions and versions

export interface Session {
  id: string;
  name: string;
  created: number;
  updated: number;
  images?: AttachedImage[] | null;
  /** Modeling language for this session. Missing = 'manifold-js'. */
  language?: 'manifold-js' | 'scad';
}

export interface AttachedImage {
  id: string;
  /** data URL or remote URL */
  src: string;
  /** User-facing caption. Shown in the Gallery, lightbox, and tooltips.
   *  May match one of the preset labels (Front, Right, Back, Left, Top,
   *  Perspective) — those drive ordering in the Elevations strip — or be
   *  a free-form custom string. Empty string and undefined both mean
   *  "no caption". */
  label?: string;
}

/** Suggested labels offered as quick picks in the UI. Items whose label
 *  matches one of these (case-insensitive) sort earlier in the Elevations
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
  index: number;
  code: string;
  geometryData: Record<string, unknown> | null;
  thumbnail: Blob | null;
  label: string;
  timestamp: number;
  notes?: string;
  /** Snapshot of annotations (freehand strokes + pinned text labels) at the time
   *  this version was saved. Shape matches `SerializedAnnotation[]` from the
   *  annotations module — kept as `unknown[]` here to preserve db-layer isolation. */
  annotations?: unknown[];
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
const DB_VERSION = 3;

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
        store.createIndex('sessionId_index', ['sessionId', 'index'], { unique: true });
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
    };
    req.onsuccess = () => {
      const db = req.result;
      migrateLegacyData(db)
        .catch(err => console.warn('Partwright: legacy session migration skipped:', err))
        .finally(() => resolve(db));
    };
    req.onerror = () => reject(req.error);
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

// === Sessions ===

export async function createSession(name?: string, language?: 'manifold-js' | 'scad'): Promise<Session> {
  const session: Session = {
    id: generateId(),
    name: name || `Session ${new Date().toLocaleDateString()}`,
    created: Date.now(),
    updated: Date.now(),
    ...(language && language !== 'manifold-js' ? { language } : {}),
  };
  const store = await tx('sessions', 'readwrite');
  await reqToPromise(store.put(session));
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

export async function updateSession(id: string, updates: Partial<Pick<Session, 'name' | 'created' | 'updated' | 'images' | 'language'>>): Promise<void> {
  const store = await tx('sessions', 'readwrite');
  const session = await reqToPromise(store.get(id)) as Session | null;
  if (!session) return;
  Object.assign(session, updates);
  // Strip legacy field if present so it doesn't shadow the new one on re-read
  delete (session as { referenceImages?: unknown }).referenceImages;
  await reqToPromise(store.put(session));
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDB();
  const txn = db.transaction(['sessions', 'versions', 'notes'], 'readwrite');
  txn.objectStore('sessions').delete(id);
  // Delete all versions for this session
  const versionStore = txn.objectStore('versions');
  const vIdx = versionStore.index('sessionId');
  const vReq = vIdx.openCursor(IDBKeyRange.only(id));
  await new Promise<void>((resolve, reject) => {
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
  // Delete all notes for this session
  const noteStore = txn.objectStore('notes');
  const nIdx = noteStore.index('sessionId');
  const nReq = nIdx.openCursor(IDBKeyRange.only(id));
  await new Promise<void>((resolve, reject) => {
    nReq.onsuccess = () => {
      const cursor = nReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    nReq.onerror = () => reject(nReq.error);
  });
  // Wait for the entire transaction to commit
  await new Promise<void>((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}

// === Versions ===

export async function saveVersion(
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
): Promise<Version> {
  const versions = await listVersions(sessionId);
  const nextIndex = versions.length > 0 ? Math.max(...versions.map(v => v.index)) + 1 : 1;

  const version: Version = {
    id: generateId(),
    sessionId,
    index: nextIndex,
    code,
    geometryData,
    thumbnail,
    label: label || `v${nextIndex}`,
    timestamp: timestamp ?? Date.now(),
    ...(notes ? { notes } : {}),
    ...(annotations && annotations.length > 0 ? { annotations } : {}),
  };

  const store = await tx('versions', 'readwrite');
  await reqToPromise(store.put(version));

  // Bump session.updated unless the caller is restoring an earlier timestamp
  // (an import that wants to preserve original session.updated will restore it after).
  await updateSession(sessionId, { updated: timestamp ?? Date.now() });

  return version;
}

export async function listVersions(sessionId: string): Promise<Version[]> {
  const store = await tx('versions', 'readonly');
  const index = store.index('sessionId');
  const versions = await reqToPromise(index.getAll(IDBKeyRange.only(sessionId))) as Version[];
  return versions.sort((a, b) => a.index - b.index);
}

export async function getLatestVersion(sessionId: string): Promise<Version | null> {
  const versions = await listVersions(sessionId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export async function getVersionByIndex(sessionId: string, index: number): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  const idx = store.index('sessionId_index');
  return reqToPromise(idx.get([sessionId, index])) as Promise<Version | null>;
}

export async function getVersionById(id: string): Promise<Version | null> {
  const store = await tx('versions', 'readonly');
  return reqToPromise(store.get(id)) as Promise<Version | null>;
}

export async function getVersionCount(sessionId: string): Promise<number> {
  const store = await tx('versions', 'readonly');
  const index = store.index('sessionId');
  return reqToPromise(index.count(IDBKeyRange.only(sessionId)));
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
  await reqToPromise(store.put(note));
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
  await reqToPromise(store.delete(id));
}

export async function updateNote(id: string, text: string): Promise<void> {
  const store = await tx('notes', 'readwrite');
  const note = await reqToPromise(store.get(id)) as SessionNote | null;
  if (!note) return;
  note.text = text;
  note.timestamp = Date.now();
  await reqToPromise(store.put(note));
}

// === Database reset ===

export async function clearAllData(): Promise<void> {
  const db = await openDB();
  const txn = db.transaction(['sessions', 'versions', 'notes'], 'readwrite');
  txn.objectStore('sessions').clear();
  txn.objectStore('versions').clear();
  txn.objectStore('notes').clear();
  await new Promise<void>((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}
