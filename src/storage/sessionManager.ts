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
  deleteVersion as dbDeleteVersion,
  putVersion as dbPutVersion,
  renameVersion as dbRenameVersion,
  clearAllData,
  updateSession as dbUpdateSession,
  addNote as dbAddNote,
  listNotes as dbListNotes,
  deleteNote as dbDeleteNote,
  updateNote as dbUpdateNote,
  legacyImagesObjectToArray,
  generateId,
  type Session,
  type Version,
  type SessionNote,
  type AttachedImage,
} from './db';
import { publishTabSync, onTabSync } from './tabSync';
import { listMessages as dbListMessages, putMessages as dbPutMessages } from '../ai/db';
import { getSpendingSummary } from '../ai/settings';
import type { ChatMessage } from '../ai/types';

/** Legacy angle keys preserved only for typing the on-disk shapes we still
 *  read for backward compatibility. */
type LegacyImageAngle = 'front' | 'right' | 'back' | 'left' | 'top' | 'perspective';
import type { SerializedColorRegion } from '../color/regions';
import {
  serializeAll as serializeAnnotations,
  loadFromSerialized as loadAnnotations,
  type SerializedAnnotation,
} from '../annotations/annotations';
import { setActiveImports, type ImportedMesh } from '../import/importedMesh';

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
 *  - `1.6` — optional AI chat transcript (`chat`) for the session. Holds the
 *           persisted conversation (text, tool calls, tool results) so a
 *           session round-trips with its chat. Only written when the caller
 *           opts in via {@link ExportOptions.includeChat}. On import each
 *           message is re-keyed to the new session; older readers ignore it.
 */
export const SCHEMA_VERSION = '1.6';

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
   * The session's AI chat transcript, oldest first. Stored without the volatile
   * `id`/`sessionId`/`errored` fields — those are regenerated/re-keyed on
   * import. Only present when exported with {@link ExportOptions.includeChat}.
   * @since 1.6
   */
  chat?: ExportedChatMessage[];
  /**
   * **Deprecated in 1.3** — top-level annotations were the 1.2 location.
   * Still read on import (assigned to the latest version) for back-compat,
   * but no longer written. New writers attach annotations per-version under
   * `versions[].annotations`.
   * @deprecated since 1.3
   */
  annotations?: SerializedAnnotation[];
}

/** A chat message as embedded in an exported session. The persisted shape
 *  minus the fields that are environment-specific: `id` and `sessionId` are
 *  regenerated/re-keyed on import, and `errored` is never persisted. */
export type ExportedChatMessage = Omit<ChatMessage, 'id' | 'sessionId' | 'errored'>;

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
  setActiveImports([]);
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
  setActiveImports((version?.importedMeshes ?? []) as ImportedMesh[]);
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
  setActiveImports([]);
  updateURL();
  notify();
}

export async function listSessions(): Promise<Session[]> {
  return dbListSessions();
}

export async function deleteSession(id: string): Promise<void> {
  await dbDeleteSession(id);
  publishTabSync({ kind: 'session-deleted', sessionId: id });
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
  publishTabSync({ kind: 'session-meta', sessionId: id });
}

export async function setSessionLanguage(id: string, language: 'manifold-js' | 'scad'): Promise<void> {
  await dbUpdateSession(id, { language, updated: Date.now() });
  if (currentState.session?.id === id) {
    currentState.session = { ...currentState.session, language, updated: Date.now() };
    notify();
  }
  publishTabSync({ kind: 'session-meta', sessionId: id });
}

// === Per-session AI preference ===

/** Remember which AI provider + model is driving the current session so it can
 *  be restored on reopen. No-op when nothing is open or the value is unchanged.
 *  Not broadcast to peer tabs on purpose — restoring on reload is the goal, not
 *  live-mirroring the active model across windows (which would fight the user). */
export async function setSessionAiPreference(provider: string, model: string | null): Promise<void> {
  if (!currentState.session || !model) return;
  const cur = currentState.session.aiPreference;
  if (cur && cur.provider === provider && cur.model === model) return;
  const id = currentState.session.id;
  const aiPreference = { provider, model };
  await dbUpdateSession(id, { aiPreference });
  if (currentState.session?.id === id) {
    currentState.session = { ...currentState.session, aiPreference };
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
  options?: { force?: boolean; importedMeshes?: ImportedMesh[] },
): Promise<Version | null> {
  if (!currentState.session) return null;

  const annotationSnapshot = serializeAnnotations();

  // Imports carry forward to new versions automatically: if the user edits
  // their imported-mesh code and re-saves, the same mesh data should still
  // back `api.imports[i]`. Pull from the current version when the caller
  // didn't provide an explicit override.
  const prevImports = (currentState.currentVersion?.importedMeshes ?? []) as ImportedMesh[];
  const nextImports = options?.importedMeshes ?? prevImports;

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
    nextImports.length > 0 ? nextImports : undefined,
  );

  currentState = {
    ...currentState,
    currentVersion: version,
    versionCount: currentState.versionCount + 1,
  };
  setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
  updateURL();
  notify();
  publishTabSync({ kind: 'session-versions', sessionId: version.sessionId });
  return version;
}

export async function navigateVersion(direction: 'prev' | 'next'): Promise<Version | null> {
  if (!currentState.session || !currentState.currentVersion) return null;

  // Step to the adjacent *existing* version. Walking the sorted list by
  // position (rather than index ± 1) keeps navigation correct after deletions
  // leave gaps in the index sequence.
  const versions = await dbListVersions(currentState.session.id);
  const pos = versions.findIndex(v => v.id === currentState.currentVersion!.id);
  if (pos === -1) return null;
  const target = versions[pos + (direction === 'prev' ? -1 : 1)];
  if (!target) return null;

  currentState = { ...currentState, currentVersion: target };
  setActiveImports((target.importedMeshes ?? []) as ImportedMesh[]);
  updateURL();
  notify();
  return target;
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
  setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
  updateURL();
  notify();
  return version;
}

export async function listCurrentVersions(): Promise<Version[]> {
  if (!currentState.session) return [];
  return dbListVersions(currentState.session.id);
}

export interface DeleteVersionResult {
  /** The full record that was removed (sufficient to restore it on undo). */
  deleted: Version;
  /** Whether the deleted version was the active one. */
  wasCurrent: boolean;
  /** The version that became active after deletion (only set when wasCurrent). */
  newCurrent: Version | null;
}

/**
 * Permanently delete a version from the active session. Refuses to remove the
 * last remaining version (a session always keeps at least one). When the active
 * version is deleted, the nearest remaining version — preferring the previous
 * index — becomes active. Returns null if the delete was refused or the id was
 * not found. Indices of surviving versions are left untouched (gaps are fine).
 */
export async function deleteVersion(versionId: string): Promise<DeleteVersionResult | null> {
  if (!currentState.session) return null;
  const versions = await dbListVersions(currentState.session.id);
  const target = versions.find(v => v.id === versionId);
  if (!target) return null;
  if (versions.length <= 1) return null; // keep at least one version

  await dbDeleteVersion(versionId);

  const remaining = versions.filter(v => v.id !== versionId);
  const wasCurrent = currentState.currentVersion?.id === versionId;
  let newCurrent: Version | null = null;
  if (wasCurrent) {
    const lower = remaining.filter(v => v.index < target.index);
    newCurrent = lower.length > 0 ? lower[lower.length - 1] : remaining[remaining.length - 1];
  }

  currentState = {
    ...currentState,
    currentVersion: wasCurrent ? newCurrent : currentState.currentVersion,
    versionCount: remaining.length,
  };
  if (wasCurrent && newCurrent) {
    setActiveImports((newCurrent.importedMeshes ?? []) as ImportedMesh[]);
  }
  updateURL();
  notify();
  return { deleted: target, wasCurrent, newCurrent };
}

/**
 * Re-insert a previously deleted version (undo), restoring its original id,
 * index, and timestamp. Optionally makes it active again. No-op if it doesn't
 * belong to the active session.
 */
export async function restoreVersion(version: Version, makeCurrent: boolean): Promise<void> {
  if (!currentState.session || version.sessionId !== currentState.session.id) return;
  await dbPutVersion(version);
  const versions = await dbListVersions(currentState.session.id);
  currentState = {
    ...currentState,
    currentVersion: makeCurrent ? version : currentState.currentVersion,
    versionCount: versions.length,
  };
  if (makeCurrent) {
    setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
  }
  updateURL();
  notify();
}

/** Rename a version's display label. The index is immutable. Returns the
 *  updated record, or null if it isn't part of the active session. */
export async function renameVersion(versionId: string, label: string): Promise<Version | null> {
  if (!currentState.session) return null;
  const target = await getVersionById(versionId);
  if (!target || target.sessionId !== currentState.session.id) return null;
  await dbRenameVersion(versionId, label);
  const updated = { ...target, label };
  if (currentState.currentVersion?.id === versionId) {
    currentState = { ...currentState, currentVersion: updated };
  }
  notify();
  return updated;
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
  const id = currentState.session.id;
  await dbUpdateSession(id, {
    images,
    updated: Date.now(),
  });
  // Update local state so getState() reflects the change
  currentState = {
    ...currentState,
    session: { ...currentState.session, images },
  };
  notify();
  publishTabSync({ kind: 'session-meta', sessionId: id });
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
  const id = currentState.session.id;
  const note = await dbAddNote(id, text);
  notifyNotes();
  publishTabSync({ kind: 'notes', sessionId: id });
  return note;
}

export async function listSessionNotes(): Promise<SessionNote[]> {
  if (!currentState.session) return [];
  return dbListNotes(currentState.session.id);
}

export async function deleteSessionNote(noteId: string): Promise<void> {
  await dbDeleteNote(noteId);
  notifyNotes();
  if (currentState.session) publishTabSync({ kind: 'notes', sessionId: currentState.session.id });
}

export async function updateSessionNote(noteId: string, text: string): Promise<void> {
  await dbUpdateNote(noteId, text);
  notifyNotes();
  if (currentState.session) publishTabSync({ kind: 'notes', sessionId: currentState.session.id });
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
    /** The AI spending budget the user has set. Agents should respect it. */
    spending: ReturnType<typeof getSpendingSummary>;
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
      spending: getSpendingSummary(),
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
    setActiveImports([]);
  }
  return true;
}

// === Clear all data ===

export async function clearAllSessions(): Promise<void> {
  await clearAllData();
  currentState = { session: null, currentVersion: null, versionCount: 0 };
  loadAnnotations([]);
  setActiveImports([]);
  updateURL();
  notify();
  publishTabSync({ kind: 'sessions-cleared' });
}

// === Cross-tab sync ===

let isViewerTab: () => boolean = () => false;

/** Register whether this tab is a read-only viewer of the open session. When it
 *  returns true, cross-tab reloads follow the latest saved version (mirror the
 *  leader) instead of pinning the version this tab happened to be on. */
export function setViewerPredicate(fn: () => boolean): void {
  isViewerTab = fn;
}

/** Public trigger to re-read the open session from IndexedDB — used when this
 *  tab becomes a read-only viewer and should snap to the leader's latest state. */
export async function refreshCurrentSession(): Promise<void> {
  await reloadCurrentSessionFromDB();
}

/** Re-read the currently-open session from IndexedDB after a peer tab changed
 *  it. Updates the persisted-version pointer and counts; the editor's working
 *  buffer is owned separately and is intentionally left untouched. */
async function reloadCurrentSessionFromDB(): Promise<void> {
  if (!currentState.session) return;
  const id = currentState.session.id;
  const session = await getSession(id);
  if (!session) {
    // A peer tab deleted the session we had open.
    currentState = { session: null, currentVersion: null, versionCount: 0 };
    setActiveImports([]);
    updateURL();
    notify();
    return;
  }
  const count = await getVersionCount(id);
  let version: Version | null;
  if (isViewerTab()) {
    // A read-only viewer mirrors the leader, so follow the latest saved version
    // instead of pinning whatever version this tab happened to be on.
    version = await getLatestVersion(id);
  } else {
    const wantedIndex = currentState.currentVersion?.index;
    version = typeof wantedIndex === 'number' ? await getVersionByIndex(id, wantedIndex) : null;
    if (!version) version = await getLatestVersion(id);
  }
  currentState = { session, currentVersion: version, versionCount: count };
  setActiveImports((version?.importedMeshes ?? []) as ImportedMesh[]);
  updateURL();
  notify();
}

let tabSyncInitialized = false;

/** Wire cross-tab session reloads. Call once at app start. When a peer tab
 *  mutates the session we currently have open, re-read it from IndexedDB so our
 *  in-memory state and the UI reflect the change instead of silently drifting.
 *  Chat and AI-settings sync are handled by their own subscribers. */
export function initSessionTabSync(): void {
  if (tabSyncInitialized) return;
  tabSyncInitialized = true;
  onTabSync(msg => {
    const cur = currentState.session?.id;
    switch (msg.kind) {
      case 'session-versions':
      case 'session-meta':
      case 'session-deleted':
        if (cur && msg.sessionId === cur) void reloadCurrentSessionFromDB();
        break;
      case 'sessions-cleared':
        currentState = { session: null, currentVersion: null, versionCount: 0 };
        loadAnnotations([]);
        setActiveImports([]);
        updateURL();
        notify();
        break;
      case 'notes':
        if (cur && msg.sessionId === cur) notifyNotes();
        break;
      case 'chat':
        break; // handled by the AI panel's own subscription
    }
  });
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
  includeChat?: boolean;
  /** Restrict the export to versions whose `index` is in this list. Undefined
   *  (the default) exports every version. Lets the caller prune history into the
   *  exported file without deleting anything from storage. */
  versionIndices?: number[];
}

const DEFAULT_EXPORT_OPTIONS: Required<Omit<ExportOptions, 'versionIndices'>> = {
  includeThumbnails: false,
  includeAnnotations: true,
  includeNotes: true,
  includeColorRegions: true,
  includeChat: true,
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

/** Drop the environment-specific fields from a persisted chat message so it can
 *  be embedded in an export (id/sessionId are regenerated on import). */
function toExportedChatMessage(m: ChatMessage): ExportedChatMessage {
  const { id: _id, sessionId: _sessionId, errored: _errored, ...rest } = m;
  return rest;
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

  const opts: Required<Omit<ExportOptions, 'versionIndices'>> = { ...DEFAULT_EXPORT_OPTIONS, ...options };

  const allVersions = await dbListVersions(id);
  const versions = options?.versionIndices
    ? allVersions.filter(v => options.versionIndices!.includes(v.index))
    : allVersions;
  const notes = opts.includeNotes ? await dbListNotes(id) : [];
  const chat = opts.includeChat ? await dbListMessages(id) : [];

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
    ...(chat.length > 0 ? { chat: chat.map(toExportedChatMessage) } : {}),
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

  // Restore the AI chat transcript (schema 1.6+). Re-key every message to the
  // new session and mint a fresh id so importing into a DB that still holds
  // the original conversation can't overwrite it. seq is preserved for order.
  if (Array.isArray(data.chat) && data.chat.length > 0) {
    const messages: ChatMessage[] = data.chat
      .filter((m): m is ExportedChatMessage =>
        !!m && (m.role === 'user' || m.role === 'assistant') && Array.isArray(m.blocks))
      .map(m => ({ ...m, id: generateId(), sessionId: session.id }));
    if (messages.length > 0) await dbPutMessages(messages);
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
  setActiveImports((latest?.importedMeshes ?? []) as ImportedMesh[]);
  updateURL();
  notify();
  publishTabSync({ kind: 'session-meta', sessionId: refreshedSession.id });

  // Note: annotations are NOT loaded here on purpose. The caller is expected to
  // route the imported session through `loadVersionIntoEditor` (or equivalent)
  // which will run the version's code, render the mesh, and call
  // `applyVersionAnnotations`. Loading them twice (once here, once in the editor
  // path) causes redundant rebuilds of the multiview offscreen renderer that
  // can land mid-render and produce a frame that misses the annotations.

  return refreshedSession;
}
