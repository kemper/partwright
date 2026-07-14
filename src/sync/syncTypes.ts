// Shared types for the external backup-sync subsystem (local folder + Google
// Drive). Dependency-free so the pure helpers can be unit-tested without a
// browser, IndexedDB, or the File System Access API.

export type SyncTargetId = 'local' | 'drive';

/** Runtime lifecycle of one sync target. Not persisted — recomputed on boot. */
export type SyncPhase =
  | 'disconnected' // no target linked
  | 'connected' // linked and idle
  | 'syncing' // a write is in flight
  | 'needs-reconnect' // linked but permission/token lapsed — user action required
  | 'error'; // last operation failed

/** In-memory status of one target, surfaced to the UI. */
export interface SyncTargetStatus {
  id: SyncTargetId;
  phase: SyncPhase;
  /** Human label for the connection — folder name or Drive account/folder. */
  label: string | null;
  /** Epoch ms of the last successful write, or null. */
  lastSyncAt: number | null;
  /** Last error message, or null. */
  lastError: string | null;
  /** Whether this target is usable in the current browser (File System Access
   *  support for 'local'; a configured OAuth client id for 'drive'). */
  available: boolean;
}

/** Persisted row for the local-folder target. */
export interface LocalTargetRecord {
  id: 'local';
  handle: FileSystemDirectoryHandle;
  folderName: string;
  connectedAt: number;
}

/** Persisted row for the Google Drive target. Access tokens are NEVER stored —
 *  only the durable folder id and the session→file-id map so repeat writes
 *  update the same Drive file instead of duplicating it. */
export interface DriveTargetRecord {
  id: 'drive';
  /** Id of the "partwright" folder in Drive, once created. */
  folderId: string | null;
  /** sessionId → Drive file id, so a re-sync PATCHes the existing file. */
  fileIds: Record<string, string>;
  /** Connected account email, best-effort, for display only. */
  email: string | null;
  connectedAt: number;
}

/** The backup filename for a session: readable slug + id for stable matching.
 *  e.g. `my_widget__a1b2c3.partwright.json`. Pure — safe to unit-test. */
export function backupFilename(slug: string, sessionId: string): string {
  const safeSlug = slug || 'session';
  return `${safeSlug}__${sessionId}.partwright.json`;
}

/** Extract the sessionId embedded in a backup filename by {@link backupFilename},
 *  or null if the name doesn't match the pattern. */
export function sessionIdFromBackupFilename(filename: string): string | null {
  const m = /__([^_/\\]+)\.partwright\.json$/.exec(filename);
  return m ? m[1] : null;
}
