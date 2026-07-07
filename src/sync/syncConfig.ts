// Deploy-time configuration for the Google Drive sync target.
//
// The OAuth client id is a per-deployment secret-less identifier supplied via
// the `VITE_GOOGLE_CLIENT_ID` build env var (set it in the Cloudflare Pages
// project — Settings → Environment variables). It is a *public* client id
// (safe to ship in the bundle); the OAuth flow is client-side implicit, so
// there is no client secret to protect. When the var is unset, Drive sync is
// simply reported as "not configured" and the UI hides/greys it — the rest of
// the app (and local-folder sync) is unaffected.

/** The Google OAuth 2.0 Web client id for this deployment, or '' when unset. */
export function getGoogleClientId(): string {
  const raw = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  return raw.trim();
}

/** True when this deployment has a Google client id wired in. */
export function isDriveConfigured(): boolean {
  return getGoogleClientId().length > 0;
}

/** The minimal Drive scope: per-file access to only files this app creates or
 *  the user explicitly opens with it. Non-sensitive → no Google app
 *  verification and no scary "unverified app" consent screen. Never broaden
 *  this without re-reading the consent-screen / verification implications. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Name of the folder created in the user's Drive to hold session backups. */
export const DRIVE_FOLDER_NAME = 'partwright';
