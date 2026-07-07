// Local-folder backup target, built on the File System Access API. Lets the
// user pick a directory on their disk; the sync manager then writes one
// `<slug>__<sessionId>.partwright.json` file per session into it on every
// change, giving them a plain-file copy of their work outside the browser.
//
// Chromium-desktop only (Firefox/Safari lack the disk pickers in 2026). Callers
// must feature-detect with `isLocalFolderSupported()` and fall back to the
// existing manual export/import for unsupported browsers. Every picker /
// permission call must be triggered by a user gesture.

import { getLocalTarget, putTarget, deleteTarget } from './syncDb';

/** True when this browser exposes the disk directory picker. */
export function isLocalFolderSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Prompt the user to pick a directory and persist the handle. Must be called
 *  from a user gesture. Returns the folder name, or null if the user cancelled. */
export async function connectLocalFolder(): Promise<string | null> {
  if (!isLocalFolderSupported()) throw new Error('This browser does not support local folder sync.');
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({ id: 'partwright-sync', mode: 'readwrite' });
  } catch (e) {
    // AbortError = user dismissed the picker; treat as a benign cancel.
    if ((e as { name?: string })?.name === 'AbortError') return null;
    throw e;
  }
  // Ensure we actually hold readwrite before recording the link.
  const perm = await requestReadwrite(handle);
  if (perm !== 'granted') throw new Error('Write permission for the folder was not granted.');
  await putTarget({ id: 'local', handle, folderName: handle.name, connectedAt: Date.now() });
  return handle.name;
}

/** Forget the linked folder (does not touch files already written to disk). */
export async function disconnectLocalFolder(): Promise<void> {
  await deleteTarget('local');
}

/** The persisted directory handle, or null if none is linked. */
export async function getLocalHandle(): Promise<FileSystemDirectoryHandle | null> {
  const rec = await getLocalTarget();
  return rec?.handle ?? null;
}

async function queryReadwrite(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted';
  return handle.queryPermission({ mode: 'readwrite' });
}

async function requestReadwrite(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (!handle.requestPermission) return 'granted';
  return handle.requestPermission({ mode: 'readwrite' });
}

/** Non-prompting permission check for a linked handle: 'granted' | 'prompt' |
 *  'denied'. A rehydrated handle typically returns 'prompt' after a reload — the
 *  UI shows a "Reconnect folder" button that calls {@link reconnectLocalFolder}
 *  (which requests permission inside the click). */
export async function checkLocalPermission(): Promise<PermissionState | 'none'> {
  const handle = await getLocalHandle();
  if (!handle) return 'none';
  return queryReadwrite(handle);
}

/** Re-acquire write permission on the already-linked handle. Must be called from
 *  a user gesture. Returns true if permission is now granted. */
export async function reconnectLocalFolder(): Promise<boolean> {
  const handle = await getLocalHandle();
  if (!handle) return false;
  const perm = await requestReadwrite(handle);
  return perm === 'granted';
}

/** Write (create or overwrite) a file in the linked folder. Assumes permission
 *  is already granted (caller checks via {@link checkLocalPermission}). */
export async function writeLocalFile(filename: string, content: string): Promise<void> {
  const handle = await getLocalHandle();
  if (!handle) throw new Error('No local folder is linked.');
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(new Blob([content], { type: 'application/json' }));
  } finally {
    await writable.close();
  }
}

/** List the backup files (`*.partwright.json`) currently in the linked folder. */
export async function listLocalBackups(): Promise<string[]> {
  const handle = await getLocalHandle();
  if (!handle) return [];
  const names: string[] = [];
  // FileSystemDirectoryHandle is async-iterable over [name, handle] entries.
  for await (const [name, entry] of handle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (entry.kind === 'file' && name.endsWith('.partwright.json')) names.push(name);
  }
  return names.sort();
}

/** Read a backup file's text content from the linked folder. */
export async function readLocalBackup(filename: string): Promise<string> {
  const handle = await getLocalHandle();
  if (!handle) throw new Error('No local folder is linked.');
  const fileHandle = await handle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return file.text();
}
