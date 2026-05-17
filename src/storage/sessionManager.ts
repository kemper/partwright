// Session manager — coordinates between storage, UI, and URL state

import {
  createSession as dbCreateSession,
  getSession,
  listSessions as dbListSessions,
  deleteSession as dbDeleteSession,
  saveVersion as dbSaveVersion,
  listVersions as dbListVersions,
  getLatestVersion,
  getVersionByIndex,
  getVersionById,
  getVersionCount,
  clearAllData,
  updateSession as dbUpdateSession,
  addNote as dbAddNote,
  listNotes as dbListNotes,
  deleteNote as dbDeleteNote,
  updateNote as dbUpdateNote,
  legacyImagesObjectToArray,
  type Session,
  type Version,
  type SessionNote,
  type AttachedImage,
} from './db';

/** Legacy angle keys preserved only for typing the on-disk shapes we still
 *  read for backward compatibility. */
type LegacyImageAngle = 'front' | 'right' | 'back' | 'left' | 'top' | 'perspective';
import type { SerializedColorRegion } from '../color/regions';
import {
  serializeAll as serializeAnnotations,
  loadFromSerialized as loadAnnotations,
  type SerializedAnnotation,
} from '../annotations/annotations';

/**
 * Current schema version for `.partwright.json` exports.
 *
 * Bump on schema changes:
 *  - **Major** (1.x → 2.x) — breaking. Older clients show a warning when
 *    opening a newer-major file.
 *  - **Minor** (1.0 → 1.1) — additive. Older clients silently ignore new fields.
 *
 * History:
 *  - `1.0` — initial schema. Color regions tunneled inside `versions[].geometryData.colorRegions`.
 *  - `1.1` — color regions promoted to an explicit `versions[].colorRegions` field. The
 *           legacy nested location is still written for backward compatibility with
 *           pre-1.1 readers, and read as a fallback when the explicit field is absent.
 *  - `1.2` — annotations (freehand strokes + pinned text labels) included at the top
 *           level. Snapshots the in-memory annotation store at export time and is
 *           restored on import. Older readers ignore the field.
 *  - `1.3` — annotations promoted to a per-version field (`versions[].annotations`).
 *           Each version snapshots its own annotations, so switching versions swaps
 *           them in. On import, files at schema 1.2 (top-level annotations) are
 *           assigned to the latest version for back-compat.
 *  - `1.4` — optional embedded version thumbnails (`versions[].thumbnail`) as
 *           base64 PNG data URLs. Only written when the caller opts in via
 *           {@link ExportOptions.includeThumbnails}. Importers prefer the
 *           embedded thumbnail when present and fall back to regenerating from
 *           code; older readers ignore the field.
 *  - `1.5` — color regions gained two new descriptor variants, both
 *           re-resolved at runtime so the triangle set is rebuilt on
 *           each load:
 *             - `{kind: 'byLabel', label}` — resolves via manifold-js's
 *               `runOriginalID` provenance (api.label / api.labeledUnion
 *               in user code). Persists the label name only.
 *             - `{kind: 'connectedFromSeed', seedPoint, seedNormal,
 *               maxDeviationDeg}` — BFS from the closest triangle to
 *               the seed, gated by per-neighbor deviation from the seed
 *               normal. Persists the seed only.
 *           Older readers ignore unknown discriminant variants; the
 *           region drops silently if its descriptor doesn't match a
 *           known kind.
 */
export const SCHEMA_VERSION = '1.5';

const CURRENT_MAJOR = 1;

export interface ExportedSession {
  /** Brand + schema version. Set to {@link SCHEMA_VERSION} on export. */
  partwright?: string;
  /** Legacy alias from the pre-rebrand era. Read as a fallback only. */
  mainifold?: string;
  /** Images may be the array form or the legacy object map ({front, right, ...}).
   * Both also exist under `referenceImages` for pre-rename exports. */
  session: { name: string; created: number; updated: number; images?: AttachedImage[] | Partial<Record<LegacyImageAngle, string>> | null; referenceImages?: AttachedImage[] | Partial<Record<LegacyImageAngle, string>> | null; language?: 'manifold-js' | 'scad' };
  versions: {
    index: number;
    code: string;
    label: string;
    geometryData: Record<string, unknown> | null;
    timestamp: number;
    notes?: string;
    /**
     * Per-version color regions. Promoted to an explicit field in schema 1.1;
     * also mirrored inside `geometryData.colorRegions` for pre-1.1 readers.
     * @since 1.1
     */
    colorRegions?: SerializedColorRegion[];
    /**
     * Per-version snapshot of freehand strokes and pinned text labels drawn on
     * the model to communicate intent. Promoted to a per-version field in 1.3.
     * @since 1.3
     */
    annotations?: SerializedAnnotation[];
    /**
     * Optional base64 PNG data URL of the version thumbnail. Only written when
     * the caller opts in (catalog/gallery use cases). Importers prefer this
     * over regenerating from code.
     * @since 1.4
     */
    thumbnail?: string;
  }[];
  notes?: { text: string; timestamp: number }[];
  /**
   * **Deprecated in 1.3** — top-level annotations were the 1.2 location.
   * Still read on import (assigned to the latest version) for back-compat,
   * but no longer written. New writers attach annotations per-version under
   * `versions[].annotations`.
   * @deprecated since 1.3
   */
  annotations?: SerializedAnnotation[];
}

interface SchemaVersionInfo {
  raw: string;
  major: number;
  minor: number;
}

/** Parse the `partwright`/`mainifold` brand string into major/minor numbers. */
export function parseSchemaVersion(data: ExportedSession): SchemaVersionInfo {
  const raw = data.partwright ?? data.mainifold ?? '1.0';
  const [majStr = '1', minStr = '0'] = raw.split('.');
  const major = parseInt(majStr, 10);
  const minor = parseInt(minStr, 10);
  return {
    raw,
    major: Number.isFinite(major) ? major : 1,
    minor: Number.isFinite(minor) ? minor : 0,
  };
}

/**
 * Returns a user-facing warning if the file's schema is from a newer major
 * version than this client supports, otherwise null.
 *
 * Newer-major: warn but proceed (best-effort import — unknown fields are dropped).
 * Older-major: silent (this client knows how to migrate).
 * Same major / minor differences: silent.
 */
export function getSchemaCompatibilityWarning(data: ExportedSession): string | null {
  const v = parseSchemaVersion(data);
  if (v.major > CURRENT_MAJOR) {
    return `This file was created with a newer Partwright (schema ${v.raw}). Some data may be missing or import incorrectly.`;
  }
  return null;
}

export type { Session, Version, SessionNote, AttachedImage } from './db';

export interface SessionState {
  session: Session | null;
  currentVersion: Version | null;
  versionCount: number;
}

type StateChangeListener = (state: SessionState) => void;

let currentState: SessionState = {
  session: null,
  currentVersion: null,
  versionCount: 0,
};

const listeners: StateChangeListener[] = [];
const notesListeners: (() => void)[] = [];

function notify() {
  for (const fn of listeners) fn(currentState);
  window.dispatchEvent(new CustomEvent('session-changed', { detail: currentState }));
}

function notifyNotes() {
  for (const fn of notesListeners) fn();
}

export function onStateChange(fn: StateChangeListener): void {
  listeners.push(fn);
}

/** Subscribe to session-note mutations (add / update / delete). */
export function onNotesChange(fn: () => void): () => void {
  notesListeners.push(fn);
  return () => {
    const i = notesListeners.indexOf(fn);
    if (i >= 0) notesListeners.splice(i, 1);
  };
}

export function getState(): SessionState {
  return currentState;
}

// === URL helpers ===

function updateURL() {
  const params = new URLSearchParams(window.location.search);
  const basePath = '/editor';
  if (currentState.session) {
    params.set('session', currentState.session.id);
    if (currentState.currentVersion) {
      params.set('v', String(currentState.currentVersion.index));
    } else {
      params.delete('v');
    }
  } else {
    params.delete('session');
    params.delete('v');
  }
  const qs = params.toString().replace(/=(?=&|$)/g, '');
  const newUrl = qs
    ? `${basePath}?${qs}`
    : basePath;
  window.history.replaceState(null, '', newUrl);
}

export function getSessionIdFromURL(): string | null {
  return new URLSearchParams(window.location.search).get('session');
}

export function getVersionFromURL(): number | null {
  const v = new URLSearchParams(window.location.search).get('v');
  return v ? parseInt(v, 10) : null;
}

// === Session operations ===

export async function createSession(name?: string, language?: 'manifold-js' | 'scad'): Promise<Session> {
  // Clean up the previous session if it was empty
  if (currentState.session) {
    await deleteIfEmpty(currentState.session.id);
  }
  const session = await dbCreateSession(name, language);
  currentState = { session, currentVersion: null, versionCount: 0 };
  // Annotations are per-version; a fresh session starts empty so nothing
  // bleeds in from the previously-active session.
  loadAnnotations([]);
  updateURL();
  notify();
  return session;
}

export async function openSession(id: string, versionIndex?: number): Promise<Version | null> {
  // Clean up the previous session if it was empty (no versions, no notes)
  if (currentState.session && currentState.session.id !== id) {
    await deleteIfEmpty(currentState.session.id);
  }

  const session = await getSession(id);
  if (!session) return null;

  const count = await getVersionCount(id);
  let version: Version | null = null;

  if (versionIndex !== undefined) {
    version = await getVersionByIndex(id, versionIndex);
  }
  if (!version) {
    version = await getLatestVersion(id);
  }

  currentState = { session, currentVersion: version, versionCount: count };
  updateURL();
  notify();
  return version;
}

export async function closeSession(): Promise<void> {
  // Clean up the session we're closing if it was empty
  if (currentState.session) {
    await deleteIfEmpty(currentState.session.id);
  }
  currentState = { session: null, currentVersion: null, versionCount: 0 };
  loadAnnotations([]);
  updateURL();
  notify();
}

export async function listSessions(): Promise<Session[]> {
  return dbListSessions();
}

export async function deleteSession(id: string): Promise<void> {
  await dbDeleteSession(id);
  if (currentState.session?.id === id) {
    await closeSession();
  }
}

export async function renameSession(id: string, newName: string): Promise<void> {
  await dbUpdateSession(id, { name: newName, updated: Date.now() });
  if (currentState.session?.id === id) {
    currentState.session = { ...currentState.session, name: newName, updated: Date.now() };
    notify();
  }
}

export async function setSessionLanguage(id: string, language: 'manifold-js' | 'scad'): Promise<void> {
  await dbUpdateSession(id, { language, updated: Date.now() });
  if (currentState.session?.id === id) {
    currentState.session = { ...currentState.session, language, updated: Date.now() };
    notify();
  }
}

// === Version operations ===

/** Stable structural comparison for annotation snapshots. Both are arrays of
 *  POJOs, so JSON-stringify is the simplest "equal value" check — order is
 *  meaningful (annotations are appended) so we don't sort. */
function annotationsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  const aArr = a ?? [];
  const bArr = b ?? [];
  if (aArr.length !== bArr.length) return false;
  if (aArr.length === 0) return true;
  return JSON.stringify(aArr) === JSON.stringify(bArr);
}

/** Color regions are persisted as `geometryData.colorRegions` on each version.
 *  Compare them so a save that only adds/edits color regions still creates a
 *  new version — code may be identical, but the painted state is the change. */
function colorRegionsEqual(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown> | null | undefined): boolean {
  const prevRegions = (prev?.colorRegions ?? []) as unknown[];
  const nextRegions = (next?.colorRegions ?? []) as unknown[];
  if (prevRegions.length !== nextRegions.length) return false;
  if (prevRegions.length === 0) return true;
  // Order is stable across saves — regions are stored in the order they were
  // added, and we serialize via the same path.
  return JSON.stringify(prevRegions) === JSON.stringify(nextRegions);
}

export async function saveVersion(
  code: string,
  geometryData: Record<string, unknown> | null,
  thumbnail: Blob | null,
  label?: string,
  notes?: string,
  options?: { force?: boolean },
): Promise<Version | null> {
  if (!currentState.session) return null;

  const annotationSnapshot = serializeAnnotations();

  // Skip if code AND annotations AND color regions are all identical to the
  // current version (unless forced). Annotations and color regions live
  // per-version, so a save that only changes either must still create a new
  // version — comparing code alone would no-op.
  if (
    !options?.force &&
    currentState.currentVersion &&
    currentState.currentVersion.code === code &&
    annotationsEqual(currentState.currentVersion.annotations, annotationSnapshot) &&
    colorRegionsEqual(currentState.currentVersion.geometryData as Record<string, unknown> | null, geometryData)
  ) {
    return null;
  }

  const version = await dbSaveVersion(
    currentState.session.id,
    code,
    geometryData,
    thumbnail,
    label,
    notes,
    undefined,
    annotationSnapshot,
  );

  currentState = {
    ...currentState,
    currentVersion: version,
    versionCount: currentState.versionCount + 1,
  };
  updateURL();
  notify();
  return version;
}

export async function navigateVersion(direction: 'prev' | 'next'): Promise<Version | null> {
  if (!currentState.session || !currentState.currentVersion) return null;

  const targetIndex = currentState.currentVersion.index + (direction === 'prev' ? -1 : 1);
  if (targetIndex < 1 || targetIndex > currentState.versionCount) return null;

  const version = await getVersionByIndex(currentState.session.id, targetIndex);
  if (!version) return null;

  currentState = { ...currentState, currentVersion: version };
  updateURL();
  notify();
  return version;
}

/** Look up a version by index (number) or id (string) without mutating current state. */
export async function peekVersion(target: number | string): Promise<Version | null> {
  if (!currentState.session) return null;
  if (typeof target === 'number') {
    return getVersionByIndex(currentState.session.id, target);
  }
  const v = await getVersionById(target);
  return v && v.sessionId === currentState.session.id ? v : null;
}

/** Load a version by index (number) or id (string). */
export async function loadVersion(target: number | string): Promise<Version | null> {
  if (!currentState.session) return null;

  let version: Version | null = null;
  if (typeof target === 'number') {
    version = await getVersionByIndex(currentState.session.id, target);
  } else {
    const v = await getVersionById(target);
    // Reject versions from other sessions to avoid cross-session pollution.
    if (v && v.sessionId === currentState.session.id) version = v;
  }
  if (!version) return null;

  currentState = { ...currentState, currentVersion: version };
  updateURL();
  notify();
  return version;
}

export async function listCurrentVersions(): Promise<Version[]> {
  if (!currentState.session) return [];
  return dbListVersions(currentState.session.id);
}

// === URL helpers for sharing ===

export function getSessionUrl(): string {
  if (!currentState.session) return window.location.href;
  const base = window.location.origin + '/editor';
  return `${base}?session=${currentState.session.id}`;
}

export function getGalleryUrl(): string {
  if (!currentState.session) return window.location.href;
  const base = window.location.origin + '/editor';
  return `${base}?session=${currentState.session.id}&gallery`;
}

// === Images ===

export async function saveImages(images: AttachedImage[] | null): Promise<void> {
  if (!currentState.session) return;
  await dbUpdateSession(currentState.session.id, {
    images,
    updated: Date.now(),
  });
  // Update local state so getState() reflects the change
  currentState = {
    ...currentState,
    session: { ...currentState.session, images },
  };
  notify();
}

export async function getImagesFromSession(): Promise<AttachedImage[] | null> {
  if (!currentState.session) return null;
  // Refresh from DB in case it was updated externally
  const session = await getSession(currentState.session.id);
  return session?.images ?? null;
}

// === Notes ===

export async function addSessionNote(text: string): Promise<SessionNote | null> {
  if (!currentState.session) return null;
  const note = await dbAddNote(currentState.session.id, text);
  notifyNotes();
  return note;
}

export async function listSessionNotes(): Promise<SessionNote[]> {
  if (!currentState.session) return [];
  return dbListNotes(currentState.session.id);
}

export async function deleteSessionNote(noteId: string): Promise<void> {
  await dbDeleteNote(noteId);
  notifyNotes();
}

export async function updateSessionNote(noteId: string, text: string): Promise<void> {
  await dbUpdateNote(noteId, text);
  notifyNotes();
}

// === Recent error tracking (for agentHints) ===

const recentErrors: { error: string; timestamp: number }[] = [];
const MAX_RECENT_ERRORS = 5;

export function recordError(error: string): void {
  recentErrors.push({ error, timestamp: Date.now() });
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
}

export function getRecentErrors(): { error: string; timestamp: number }[] {
  return [...recentErrors];
}

// === Session context (single call for AI agents) ===

export interface SessionContext {
  session: { id: string; name: string; created: number; updated: number; language: 'manifold-js' | 'scad' };
  versions: {
    index: number;
    label: string;
    timestamp: number;
    notes?: string;
    geometrySummary: {
      volume?: number;
      surfaceArea?: number;
      boundingBox?: { dimensions: number[] };
      componentCount?: number;
      genus?: number;
      isManifold?: boolean;
    } | null;
  }[];
  notes: { id: string; text: string; timestamp: number }[];
  currentVersion: { index: number; label: string } | null;
  versionCount: number;
  agentHints: {
    apiDocsUrl: string;
    recommendedEntrypoint: string;
    codeMustReturnManifold: boolean;
    language: 'manifold-js' | 'scad';
    supportedLanguages: string[];
    recentErrors: { error: string; timestamp: number }[];
  };
}

export async function getSessionContext(): Promise<SessionContext | null> {
  if (!currentState.session) return null;

  const session = currentState.session;
  const versions = await dbListVersions(session.id);
  const notes = await dbListNotes(session.id);

  return {
    session: {
      id: session.id,
      name: session.name,
      created: session.created,
      updated: session.updated,
      language: session.language ?? 'manifold-js',
    },
    versions: versions.map(v => {
      const geo = v.geometryData as Record<string, unknown> | null;
      const bb = geo?.boundingBox as Record<string, unknown> | undefined;
      return {
        index: v.index,
        label: v.label,
        timestamp: v.timestamp,
        ...(v.notes ? { notes: v.notes } : {}),
        geometrySummary: geo && geo.status === 'ok' ? {
          volume: geo.volume as number | undefined,
          surfaceArea: geo.surfaceArea as number | undefined,
          boundingBox: bb?.dimensions ? { dimensions: bb.dimensions as number[] } : undefined,
          componentCount: geo.componentCount as number | undefined,
          genus: geo.genus as number | undefined,
          isManifold: geo.isManifold as boolean | undefined,
        } : null,
      };
    }),
    notes: notes.map(n => ({ id: n.id, text: n.text, timestamp: n.timestamp })),
    currentVersion: currentState.currentVersion
      ? { index: currentState.currentVersion.index, label: currentState.currentVersion.label }
      : null,
    versionCount: currentState.versionCount,
    agentHints: {
      apiDocsUrl: '/ai.md',
      recommendedEntrypoint: 'runAndSave',
      codeMustReturnManifold: (session.language ?? 'manifold-js') === 'manifold-js',
      language: session.language ?? 'manifold-js',
      supportedLanguages: ['manifold-js', 'scad'],
      recentErrors: getRecentErrors(),
    },
  };
}

// === Cleanup ===

/** Delete a session if it has no versions and no notes (used for auto-created empty sessions) */
export async function deleteIfEmpty(sessionId: string): Promise<boolean> {
  const count = await getVersionCount(sessionId);
  if (count > 0) return false;
  const notes = await dbListNotes(sessionId);
  if (notes.length > 0) return false;
  await dbDeleteSession(sessionId);
  if (currentState.session?.id === sessionId) {
    currentState = { session: null, currentVersion: null, versionCount: 0 };
  }
  return true;
}

// === Clear all data ===

export async function clearAllSessions(): Promise<void> {
  await clearAllData();
  currentState = { session: null, currentVersion: null, versionCount: 0 };
  loadAnnotations([]);
  updateURL();
  notify();
}

// === Export / Import ===

/** Pull `colorRegions` out of a version's `geometryData` blob, if present and non-empty. */
function extractColorRegions(geometryData: Record<string, unknown> | null): SerializedColorRegion[] | undefined {
  if (!geometryData) return undefined;
  const cr = geometryData.colorRegions;
  if (Array.isArray(cr) && cr.length > 0) return cr as SerializedColorRegion[];
  return undefined;
}

/**
 * Toggles for what gets included in an exported session JSON. Defaults match
 * the historical behavior (all session-bound data on, thumbnails off — since
 * the importer regenerates them from code unless an embedded one is present).
 */
export interface ExportOptions {
  includeThumbnails?: boolean;
  includeAnnotations?: boolean;
  includeNotes?: boolean;
  includeColorRegions?: boolean;
}

const DEFAULT_EXPORT_OPTIONS: Required<ExportOptions> = {
  includeThumbnails: false,
  includeAnnotations: true,
  includeNotes: true,
  includeColorRegions: true,
};

/** Read a Blob as a base64 data URL (e.g. "data:image/png;base64,..."). */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Decode a base64 data URL back into a Blob. Returns null on parse failure. */
function dataURLToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, payload] = match;
  const isBase64 = dataUrl.includes(';base64,');
  try {
    const bin = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime || 'application/octet-stream' });
  } catch {
    return null;
  }
}

/** Strip `colorRegions` from a geometryData blob without mutating the original. */
function stripColorRegions(geometryData: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!geometryData) return geometryData;
  if (!('colorRegions' in geometryData)) return geometryData;
  const { colorRegions: _omit, ...rest } = geometryData;
  return rest;
}

export async function exportSession(
  sessionId?: string,
  options?: ExportOptions,
): Promise<ExportedSession | null> {
  const id = sessionId ?? currentState.session?.id;
  if (!id) return null;

  const session = await getSession(id);
  if (!session) return null;

  const opts: Required<ExportOptions> = { ...DEFAULT_EXPORT_OPTIONS, ...options };

  const versions = await dbListVersions(id);
  const notes = opts.includeNotes ? await dbListNotes(id) : [];

  // Thumbnail conversion: read each version's Blob and convert to base64 data URL.
  // Done in parallel since FileReader is async per-blob.
  const thumbnailDataUrls: (string | null)[] = await Promise.all(
    versions.map(v => (opts.includeThumbnails && v.thumbnail) ? blobToDataURL(v.thumbnail) : Promise.resolve(null)),
  );

  return {
    partwright: SCHEMA_VERSION,
    session: { name: session.name, created: session.created, updated: session.updated, images: session.images ?? null, ...(session.language ? { language: session.language } : {}) },
    versions: versions.map((v, i) => {
      const colorRegions = opts.includeColorRegions ? extractColorRegions(v.geometryData) : undefined;
      const geometryData = opts.includeColorRegions ? v.geometryData : stripColorRegions(v.geometryData);
      const versionAnnotations = opts.includeAnnotations ? ((v.annotations ?? []) as SerializedAnnotation[]) : [];
      const thumbDataUrl = thumbnailDataUrls[i];
      return {
        index: v.index,
        code: v.code,
        label: v.label,
        geometryData,
        timestamp: v.timestamp,
        ...(v.notes ? { notes: v.notes } : {}),
        ...(colorRegions ? { colorRegions } : {}),
        ...(versionAnnotations.length > 0 ? { annotations: versionAnnotations } : {}),
        ...(thumbDataUrl ? { thumbnail: thumbDataUrl } : {}),
      };
    }),
    ...(notes.length > 0 ? { notes: notes.map(n => ({ text: n.text, timestamp: n.timestamp })) } : {}),
  };
}

export async function importSession(
  data: ExportedSession,
  regenerateThumbnail?: (code: string) => Promise<Blob | null>,
  onWarning?: (message: string) => void,
): Promise<Session> {
  const warning = getSchemaCompatibilityWarning(data);
  if (warning && onWarning) onWarning(warning);

  const session = await dbCreateSession(data.session.name, data.session.language);

  // Restore images if present in the exported data. Handle two legacy shapes:
  //   - pre-rename: `referenceImages` instead of `images`
  //   - pre-array: object map `{front: 'url', ...}` instead of `[{id, angle, src}]`
  const rawImages = data.session.images ?? data.session.referenceImages ?? null;
  if (rawImages) {
    const imagesArr = Array.isArray(rawImages)
      ? rawImages
      : legacyImagesObjectToArray(rawImages);
    await dbUpdateSession(session.id, { images: imagesArr });
  }

  // Determine the index of the latest exported version. Schema 1.2 stored
  // annotations at the top level; for back-compat we attach them to whichever
  // version was most recent at export time (assumed to be the highest index).
  const latestExportedIndex = data.versions.reduce((m, v) => Math.max(m, v.index), -Infinity);

  for (const v of data.versions) {
    // Normalize color regions: prefer the explicit (1.1+) field; fall back to the legacy
    // nested location (`geometryData.colorRegions`) for pre-1.1 files. Mirror the result
    // back into `geometryData` so existing read paths (e.g. rehydrateColorRegions, gallery
    // badges) continue to find them in their historical location.
    const explicitRegions = v.colorRegions;
    const nestedRegions = extractColorRegions(v.geometryData);
    const regions = explicitRegions ?? nestedRegions;

    let geometryData = v.geometryData;
    if (regions && (!geometryData || !Array.isArray((geometryData as Record<string, unknown>).colorRegions))) {
      geometryData = { ...(geometryData ?? {}), colorRegions: regions };
    }

    // Prefer an embedded thumbnail (schema 1.3+) — avoids re-running WASM
    // and gives us the exact image the exporter saw. Fall back to
    // regenerating from code when the field is absent.
    let thumbnail: Blob | null = null;
    if (v.thumbnail) thumbnail = dataURLToBlob(v.thumbnail);
    if (!thumbnail && regenerateThumbnail) {
      thumbnail = await regenerateThumbnail(v.code);
    }

    // Annotations: prefer the per-version field (1.3+). Fall back to the
    // top-level field (1.2) attached to the latest exported version only.
    let versionAnnotations: SerializedAnnotation[] | undefined = v.annotations;
    if (!versionAnnotations && data.annotations && data.annotations.length > 0 && v.index === latestExportedIndex) {
      versionAnnotations = data.annotations;
    }

    await dbSaveVersion(
      session.id,
      v.code,
      geometryData,
      thumbnail,
      v.label,
      v.notes,
      v.timestamp,
      versionAnnotations,
    );
  }

  // Restore session notes
  if (data.notes) {
    for (const n of data.notes) {
      await dbAddNote(session.id, n.text);
    }
  }

  // Restore the session's original created/updated timestamps so the schema round-trips
  // byte-equivalently. (dbCreateSession set these to Date.now(); dbSaveVersion bumped
  // `updated` per version. Override both back to the exported values now.)
  await dbUpdateSession(session.id, {
    created: data.session.created,
    updated: data.session.updated,
  });

  const refreshedSession = (await getSession(session.id)) ?? session;
  const count = await getVersionCount(session.id);
  const latest = await getLatestVersion(session.id);
  currentState = { session: refreshedSession, currentVersion: latest, versionCount: count };
  updateURL();
  notify();

  // Note: annotations are NOT loaded here on purpose. The caller is expected to
  // route the imported session through `loadVersionIntoEditor` (or equivalent)
  // which will run the version's code, render the mesh, and call
  // `applyVersionAnnotations`. Loading them twice (once here, once in the editor
  // path) causes redundant rebuilds of the multiview offscreen renderer that
  // can land mid-render and produce a frame that misses the annotations.

  return refreshedSession;
}
