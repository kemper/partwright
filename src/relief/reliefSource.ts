// Persistence for a relief session's original source image. The relief mesh
// itself already survives via the Version's importedMeshes; this keeps the
// *source* (the picked PNG/JPG/SVG blob) so the import wizard can be reopened
// pre-loaded — the user re-tunes without re-uploading. Stored in IndexedDB
// (not localStorage) because photos can easily exceed the ~5MB localStorage
// quota. Keyed by sessionId; cascade-deleted with the session in db.ts.

import {
  getReliefSourceRecord,
  setReliefSourceRecord,
  deleteReliefSourceRecord,
  type ReliefSourceRecord,
} from '../storage/db';

export interface ReliefSource {
  file: File;
  isSvg: boolean;
}

/** Persist the source blob used to generate a relief session. Best-effort:
 *  storage failures are swallowed so they never break the import itself. */
export async function saveReliefSource(sessionId: string, blob: Blob, filename: string, isSvg: boolean): Promise<void> {
  try {
    await setReliefSourceRecord({ sessionId, blob, filename, isSvg, timestamp: Date.now() });
  } catch {
    /* remembering the source is a convenience — never fail the import for it */
  }
}

/** Load the stored source for a relief session as a ready-to-reopen File, or
 *  null when nothing was saved (old sessions, or a storage miss). */
export async function getReliefSource(sessionId: string): Promise<ReliefSource | null> {
  let record: ReliefSourceRecord | null;
  try {
    record = await getReliefSourceRecord(sessionId);
  } catch {
    return null;
  }
  if (!record) return null;
  const type = record.isSvg ? 'image/svg+xml' : (record.blob.type || 'application/octet-stream');
  const file = new File([record.blob], record.filename, { type });
  return { file, isSvg: record.isSvg };
}

export async function deleteReliefSource(sessionId: string): Promise<void> {
  try {
    await deleteReliefSourceRecord(sessionId);
  } catch {
    /* best-effort */
  }
}
