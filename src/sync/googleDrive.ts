// Google Drive backup target — 100% client-side, no backend.
//
// Auth: OAuth 2.0 implicit ("token") flow via a full-page REDIRECT (not a
// popup). The popup token flow would need `Cross-Origin-Opener-Policy` relaxed
// from `same-origin`, but this app hard-requires cross-origin isolation for its
// WASM engine (SharedArrayBuffer) — relaxing COOP risks breaking the editor on
// browsers that don't honor `restrict-properties`. A redirect has no opener
// relationship, so it works with the existing headers untouched, on every
// browser, with no CSP change (the Drive REST fetches ride the existing
// `connect-src https:`).
//
// Scope: `drive.file` only — the app can touch only files it creates. It makes
// a visible "partwright" folder and writes session JSON there; it can see
// nothing else in the user's Drive. This non-sensitive scope needs no Google
// verification and shows no "unverified app" warning.
//
// Tokens live in memory only (~1h), never persisted. On expiry the user
// re-consents (a redirect); `drive.file` implicit flow issues no refresh token.

import { appPath } from '../deployment';
import { getConfig } from '../config/appConfig';
import { getDriveTarget, putTarget, deleteTarget } from './syncDb';
import { getGoogleClientId, DRIVE_SCOPE, DRIVE_FOLDER_NAME, isDriveConfigured } from './syncConfig';
import type { DriveTargetRecord } from './syncTypes';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const STATE_KEY = 'partwright-drive-oauth-state';
const RETURN_KEY = 'partwright-drive-oauth-return';

// In-memory access token — deliberately not persisted.
let accessToken: string | null = null;
let tokenExpiresAt = 0;

export { isDriveConfigured };

/** True when a non-expired access token is held in memory. */
export function hasDriveToken(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - getConfig().sync.driveTokenExpirySkewMs;
}

function requireToken(): string {
  if (!hasDriveToken()) throw new DriveAuthError('Google Drive session expired — reconnect.');
  return accessToken!;
}

/** Raised when a Drive call fails because auth lapsed (no/expired token, or a
 *  401 from the API). The sync manager maps this to a 'needs-reconnect' status
 *  rather than a hard error. */
export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The fixed redirect URI to register in the Google Cloud console. No query
 *  string (Google requires an exact match); session context rides in `state`. */
export function driveRedirectUri(): string {
  return `${window.location.origin}${appPath('/editor')}`;
}

/** Begin the Drive OAuth redirect. Stashes a CSRF state nonce and the URL to
 *  return to, then navigates the whole tab to Google's consent screen.
 *  `silent` uses `prompt=none` for a re-auth that skips UI when the Google
 *  session is still valid (used to refresh an expired token). */
export function beginDriveAuth(opts: { silent?: boolean } = {}): void {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Google Drive sync is not configured on this deployment.');
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  // Return to wherever the user was (session/version query + tab), minus any
  // stale oauth hash. Restored on the way back so a connect doesn't lose place.
  sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
    prompt: opts.silent ? 'none' : 'consent',
  });
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

/** Consume an OAuth redirect result from `location.hash`, if present. Call this
 *  once, very early in boot — before routing reads the URL. Returns:
 *   - { handled: true, ok: true, returnUrl } when a token was captured
 *   - { handled: true, ok: false, error } when Google returned an error
 *   - { handled: false } when this load is not an OAuth return.
 *  On a handled result the OAuth hash is stripped from the URL. */
export function consumeDriveAuthRedirect(): (
  | { handled: true; ok: true; returnUrl: string | null }
  | { handled: true; ok: false; error: string }
  | { handled: false }
) {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return { handled: false };
  const params = new URLSearchParams(hash);
  const hasToken = params.has('access_token');
  const hasError = params.has('error');
  if (!hasToken && !hasError) return { handled: false };

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  const returnUrl = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  // Strip the oauth fragment so a later reload/share-hash parse doesn't see it.
  stripHash();

  if (hasError) {
    return { handled: true, ok: false, error: params.get('error') || 'authorization failed' };
  }
  // CSRF: the returned state must match what we stored before redirecting.
  if (!expectedState || params.get('state') !== expectedState) {
    return { handled: true, ok: false, error: 'state mismatch — ignoring auth response' };
  }
  accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || '3600');
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  return { handled: true, ok: true, returnUrl };
}

function stripHash(): void {
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', url);
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = requireToken();
  const res = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    accessToken = null;
    tokenExpiresAt = 0;
    throw new DriveAuthError('Google Drive authorization lapsed — reconnect.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

async function loadDriveRecord(): Promise<DriveTargetRecord> {
  const rec = await getDriveTarget();
  return rec ?? { id: 'drive', folderId: null, fileIds: {}, email: null, connectedAt: Date.now() };
}

/** Find (or create) the app's "partwright" folder, caching its id in the record.
 *  Under `drive.file`, name-search only returns folders this app created. */
async function ensureFolder(): Promise<string> {
  const rec = await loadDriveRecord();
  if (rec.folderId) return rec.folderId;

  const q = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const listRes = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
  const list = (await listRes.json()) as { files?: { id: string }[] };
  let folderId = list.files?.[0]?.id ?? null;

  if (!folderId) {
    const createRes = await driveFetch('/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    folderId = ((await createRes.json()) as { id: string }).id;
  }

  await putTarget({ ...rec, folderId });
  return folderId;
}

function multipartBody(metadata: object, content: string, boundary: string): string {
  return (
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${content}\r\n` +
    `--${boundary}--`
  );
}

/** Look up an existing file id for this session — first from the cached map,
 *  then by name inside the folder (recovers the mapping after a reconnect on a
 *  new device where the in-memory map was empty). */
async function findFileId(
  rec: DriveTargetRecord,
  sessionId: string,
  filename: string,
  folderId: string,
): Promise<string | null> {
  if (rec.fileIds[sessionId]) return rec.fileIds[sessionId];
  const q = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  const list = (await res.json()) as { files?: { id: string }[] };
  return list.files?.[0]?.id ?? null;
}

/** Create or update the backup file for one session in the Drive folder. */
export async function uploadDriveSession(
  sessionId: string,
  filename: string,
  content: string,
): Promise<void> {
  const folderId = await ensureFolder();
  const rec = await loadDriveRecord();
  const existingId = await findFileId(rec, sessionId, filename, folderId);
  const boundary = `pw_${randomState()}`;

  if (existingId) {
    // Update content (and name in case the session was renamed). Don't resend
    // parents on PATCH.
    await driveFetch(`/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody({ name: filename }, content, boundary),
    });
    if (rec.fileIds[sessionId] !== existingId) {
      await putTarget({ ...rec, fileIds: { ...rec.fileIds, [sessionId]: existingId } });
    }
  } else {
    const res = await driveFetch('/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody({ name: filename, parents: [folderId] }, content, boundary),
    });
    const id = ((await res.json()) as { id: string }).id;
    await putTarget({ ...rec, fileIds: { ...rec.fileIds, [sessionId]: id } });
  }
}

/** List the session backups in the Drive folder (newest first). */
export async function listDriveBackups(): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  const folderId = await ensureFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`,
  );
  const list = (await res.json()) as { files?: { id: string; name: string; modifiedTime: string }[] };
  return list.files ?? [];
}

/** Download a backup file's JSON text by Drive file id. */
export async function downloadDriveFile(fileId: string): Promise<string> {
  const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media`);
  return res.text();
}

/** Whether a Drive folder is linked (persisted), regardless of token freshness. */
export async function isDriveLinked(): Promise<boolean> {
  const rec = await getDriveTarget();
  return !!rec;
}

/** Forget the Drive link and revoke the in-memory token (best-effort). */
export async function disconnectDrive(): Promise<void> {
  const token = accessToken;
  accessToken = null;
  tokenExpiresAt = 0;
  await deleteTarget('drive');
  if (token) {
    // Fire-and-forget revoke; never block disconnect on it.
    void fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  }
}

/** Record the Drive link after a successful auth (so `isDriveLinked` is true
 *  even before the first write creates the folder). */
export async function markDriveLinked(): Promise<void> {
  const rec = await getDriveTarget();
  if (!rec) await putTarget({ id: 'drive', folderId: null, fileIds: {}, email: null, connectedAt: Date.now() });
}
