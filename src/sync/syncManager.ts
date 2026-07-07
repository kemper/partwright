// Orchestrator for external backup sync. Subscribes to session/version changes
// and writes a full-fidelity `.partwright.json` per session to every connected
// target (local folder and/or Google Drive), debounced so a burst of edits
// coalesces into one write. Holds the in-memory status both targets' UI reads.
//
// Scope: the ACTIVE session is written on each change (the common "back up what
// I'm working on" case); `backupAllSessions()` pushes a full snapshot on demand
// and on first connect. Reads (restore) are explicit, never automatic — this is
// a one-way backup, not a bidirectional live sync, so there's no merge/conflict
// resolution to get wrong.

import { onStateChange, getState, exportSession, listSessions } from '../storage/sessionManager';
import { slugify } from '../export/session';
import { getConfig } from '../config/appConfig';
import type { ExportedSession } from '../storage/sessionManager';
import type { SyncTargetId, SyncTargetStatus, SyncPhase } from './syncTypes';
import { backupFilename } from './syncTypes';
import {
  isLocalFolderSupported,
  connectLocalFolder,
  disconnectLocalFolder,
  reconnectLocalFolder,
  checkLocalPermission,
  writeLocalFile,
  listLocalBackups,
  readLocalBackup,
  getLocalHandle,
} from './localFolder';
import {
  isDriveConfigured,
  hasDriveToken,
  isDriveLinked,
  beginDriveAuth,
  disconnectDrive,
  uploadDriveSession,
  listDriveBackups,
  downloadDriveFile,
  markDriveLinked,
  consumeDriveAuthRedirect,
  DriveAuthError,
} from './googleDrive';

type StatusMap = Record<SyncTargetId, SyncTargetStatus>;
type SyncListener = (s: StatusMap) => void;

const status: StatusMap = {
  local: mkStatus('local', isLocalFolderSupported()),
  drive: mkStatus('drive', isDriveConfigured()),
};

function mkStatus(id: SyncTargetId, available: boolean): SyncTargetStatus {
  return { id, phase: 'disconnected', label: null, lastSyncAt: null, lastError: null, available };
}

const listeners = new Set<SyncListener>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function onSyncChange(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSyncStatuses(): StatusMap {
  return status;
}

/** True when at least one target is linked (connected or awaiting reconnect). */
export function isAnyTargetLinked(): boolean {
  return (['local', 'drive'] as const).some(
    (id) => status[id].phase !== 'disconnected',
  );
}

function emit(): void {
  for (const fn of listeners) fn(status);
}

function setPhase(id: SyncTargetId, phase: SyncPhase, patch: Partial<SyncTargetStatus> = {}): void {
  status[id] = { ...status[id], phase, ...patch };
  emit();
}

// ─── boot ───────────────────────────────────────────────────────────────────

/** Consume a Google Drive OAuth redirect result, if this page load is one. Call
 *  FIRST in boot, before routing reads the URL. Returns the URL to restore
 *  (the page the user was on before connecting), or null. */
export function processDriveAuthReturn(): string | null {
  const result = consumeDriveAuthRedirect();
  if (!result.handled) return null;
  if (result.ok) {
    void markDriveLinked().then(() => {
      setPhase('drive', 'connected', { label: 'Google Drive', lastError: null });
      // Kick an initial backup of the active session now that we have a token.
      scheduleSync(true);
    });
    return result.returnUrl;
  }
  setPhase('drive', 'error', { lastError: `Drive sign-in failed: ${result.error}` });
  return null;
}

/** Reconstruct target status from persisted links and subscribe to changes.
 *  Idempotent. */
export async function initSyncManager(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Local folder: linked handle may need a permission re-grant after reload.
  try {
    const handle = await getLocalHandle();
    if (handle) {
      const perm = await checkLocalPermission();
      if (perm === 'granted') setPhase('local', 'connected', { label: handle.name });
      else setPhase('local', 'needs-reconnect', { label: handle.name });
    }
  } catch {
    /* local folder unavailable — leave disconnected */
  }

  // Drive: link persists, but the in-memory token does not survive a plain
  // reload (only an OAuth return sets it). processDriveAuthReturn may have
  // already set 'connected' this load.
  try {
    if (status.drive.phase === 'disconnected' && (await isDriveLinked())) {
      if (hasDriveToken()) setPhase('drive', 'connected', { label: 'Google Drive' });
      else setPhase('drive', 'needs-reconnect', { label: 'Google Drive' });
    }
  } catch {
    /* ignore */
  }

  onStateChange(() => scheduleSync());
}

// ─── write path ───────────────────────────────────────────────────────────────

function scheduleSync(immediate = false): void {
  if (!isAnyTargetLinked()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  const delay = immediate ? 0 : getConfig().sync.debounceMs;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncCurrentSession();
  }, delay);
}

async function serializeSession(sessionId: string): Promise<{ filename: string; content: string } | null> {
  const data = await exportSession(sessionId);
  if (!data) return null;
  const filename = backupFilename(slugify(data.session.name), sessionId);
  return { filename, content: JSON.stringify(data, null, 2) };
}

/** Write the active session to every target that's ready to receive it. */
async function syncCurrentSession(): Promise<void> {
  const sessionId = getState().session?.id;
  if (!sessionId) return;
  const payload = await serializeSession(sessionId);
  if (!payload) return;
  await Promise.all([
    writeToTarget('local', sessionId, payload.filename, payload.content),
    writeToTarget('drive', sessionId, payload.filename, payload.content),
  ]);
}

async function writeToTarget(
  id: SyncTargetId,
  sessionId: string,
  filename: string,
  content: string,
): Promise<void> {
  if (status[id].phase !== 'connected' && status[id].phase !== 'syncing' && status[id].phase !== 'error') return;
  const prevLabel = status[id].label;
  setPhase(id, 'syncing');
  try {
    if (id === 'local') {
      const perm = await checkLocalPermission();
      if (perm !== 'granted') {
        setPhase('local', 'needs-reconnect', { label: prevLabel });
        return;
      }
      await writeLocalFile(filename, content);
    } else {
      if (!hasDriveToken()) {
        setPhase('drive', 'needs-reconnect', { label: prevLabel });
        return;
      }
      await uploadDriveSession(sessionId, filename, content);
    }
    setPhase(id, 'connected', { label: prevLabel, lastSyncAt: Date.now(), lastError: null });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      setPhase('drive', 'needs-reconnect', { label: prevLabel });
      return;
    }
    setPhase(id, 'error', { label: prevLabel, lastError: e instanceof Error ? e.message : String(e) });
  }
}

/** Push every stored session to the connected targets (full snapshot). Used on
 *  first connect and from the "Back up all sessions" action. Returns the count
 *  written. */
export async function backupAllSessions(): Promise<number> {
  if (!isAnyTargetLinked()) return 0;
  const sessions = await listSessions();
  let count = 0;
  for (const s of sessions) {
    const payload = await serializeSession(s.id);
    if (!payload) continue;
    await Promise.all([
      writeToTarget('local', s.id, payload.filename, payload.content),
      writeToTarget('drive', s.id, payload.filename, payload.content),
    ]);
    count++;
  }
  return count;
}

// ─── connect / disconnect ───────────────────────────────────────────────────

export async function connectLocal(): Promise<boolean> {
  const name = await connectLocalFolder();
  if (!name) return false; // user cancelled
  setPhase('local', 'connected', { label: name, lastError: null });
  void backupAllSessions();
  return true;
}

export async function reconnectLocal(): Promise<boolean> {
  const ok = await reconnectLocalFolder();
  if (ok) {
    setPhase('local', 'connected', { lastError: null });
    scheduleSync(true);
  }
  return ok;
}

export async function disconnectLocal(): Promise<void> {
  await disconnectLocalFolder();
  setPhase('local', 'disconnected', { label: null, lastSyncAt: null, lastError: null });
}

/** Begin (or re-begin) the Drive OAuth redirect. Navigates away — after the
 *  round-trip, processDriveAuthReturn finishes the connection. */
export function connectDrive(): void {
  beginDriveAuth();
}

export async function disconnectDriveTarget(): Promise<void> {
  await disconnectDrive();
  setPhase('drive', 'disconnected', { label: null, lastSyncAt: null, lastError: null });
}

// ─── restore (read-back) ────────────────────────────────────────────────────

export interface BackupEntry {
  /** Key used to read the backup: filename for local, Drive file id for drive. */
  key: string;
  /** Display name (filename). */
  name: string;
  target: SyncTargetId;
}

export async function listBackups(target: SyncTargetId): Promise<BackupEntry[]> {
  if (target === 'local') {
    const names = await listLocalBackups();
    return names.map((name) => ({ key: name, name, target }));
  }
  const files = await listDriveBackups();
  return files.map((f) => ({ key: f.id, name: f.name, target }));
}

export async function readBackup(target: SyncTargetId, key: string): Promise<ExportedSession> {
  const text = target === 'local' ? await readLocalBackup(key) : await downloadDriveFile(key);
  return JSON.parse(text) as ExportedSession;
}
