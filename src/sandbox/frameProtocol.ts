// Frame-side half of the engine-sandbox wire protocol (see protocol.ts for the
// app side and the overall picture). Imported ONLY by the sandbox frame
// (sandboxMain.ts) and its Worker shim (sandboxWorker.ts) — never by the app
// bundle — so the app doesn't load a shared chunk for it when the sandbox is
// off. protocol.ts re-declares the few constants both sides need;
// tests/unit/engineSandbox.test.ts asserts the two copies stay identical.
//
// Pure — no DOM — so it runs in the unit tier.

/** frame → Worker: hands over the app's MessagePort. */
export const CONNECT_MESSAGE_TYPE = '__sandbox_connect';
/** Worker → app (on the port): first message, the isolation report. */
export const STATUS_MESSAGE_TYPE = '__sandbox_status';
/** Worker → frame: the bootstrap's `import()` of the shim failed. */
export const BOOT_ERROR_MESSAGE_TYPE = '__sandbox_boot_error';
/** Global the classic bootstrap parks its early-message queue on. */
export const BOOT_GLOBAL = '__partwrightSandboxBoot';

/** app → frame (a `spawn` carries that Worker's MessagePort in `ports[0]`). */
export type ParentToFrame =
  | { type: 'spawn'; id: string }
  | { type: 'terminate'; id: string }
  | { type: 'ping'; id: string };

/** frame → app */
export type FrameToParent =
  | { type: 'frame_ready'; coi: boolean; sab: boolean }
  | { type: 'spawn_failed'; id: string; message: string }
  | { type: 'worker_error'; id: string; message: string }
  | { type: 'pong'; id: string };

/** Validate a message the app posted to the frame. */
export function parseParentMessage(data: unknown): ParentToFrame | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 64) return null;
  if (d.type === 'spawn' || d.type === 'terminate' || d.type === 'ping') return { type: d.type, id: d.id };
  return null;
}

/** Origins the frame accepts `spawn`/`terminate` from: its own URL origin
 *  (opaque mode embeds it at the app's URL, so that IS the app) plus the
 *  build-time app origin list (`VITE_APP_ORIGIN`, comma-separated) for 'origin'
 *  mode, where the frame lives on a different host than the app. */
export function allowedParentOrigins(urlOrigin: string, configured: unknown): Set<string> {
  const out = new Set<string>();
  if (urlOrigin && urlOrigin !== 'null') out.add(urlOrigin);
  if (typeof configured === 'string') {
    for (const part of configured.split(',')) {
      try {
        const u = new URL(part.trim());
        if (u.protocol === 'https:' || u.protocol === 'http:') out.add(u.origin);
      } catch { /* skip invalid entries */ }
    }
  }
  return out;
}
