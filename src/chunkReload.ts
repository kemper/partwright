// Recovery logic for stale-deploy dynamic-import failures.
//
// The app is a single static bundle whose chunks carry content-hashed names
// (e.g. `main-DZLxNqfy.js`). When a new build deploys while a tab is open — or
// the tab loaded a half-swapped asset set during the deploy window — the page
// holds references to chunk hashes the server no longer has. Importing one then
// 404s, and Cloudflare's SPA fallback (`/* /index.html 200`) serves index.html
// in its place, which the browser rejects as the wrong MIME type:
//   "Failed to load module script: Expected a JavaScript-or-Wasm module script
//    but the server responded with a MIME type of 'text/html'."
//   "Failed to fetch dynamically imported module: …/assets/main-XXXX.js"
//
// `src/entry.ts` is the only statically-loaded module, so it's the single place
// the app-bundle import can fail. Left unhandled, the rejection is silent and
// the loading splash (removed only once main.ts runs) spins forever. The remedy
// is a one-time hard reload: a fresh navigation fetches the new index.html and
// its matching chunk hashes. This module holds the pure decision logic so it's
// unit-testable; entry.ts wires it to the real `sessionStorage`/`location`/DOM.

// sessionStorage flag marking that we've already auto-reloaded this session, so
// a genuinely persistent failure (offline, a chunk truly gone) doesn't loop.
// A structural key, not a tunable knob — intentionally inline.
export const CHUNK_RELOAD_GUARD_KEY = 'pw:chunkReloadAttempted';

/**
 * True when an error looks like a failed dynamic-import / module-script load —
 * the signature of a stale-deploy chunk mismatch — rather than a runtime bug
 * thrown while the module evaluated. Matches the wording browsers use across
 * Chrome, Firefox, and Safari.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String((err as { message?: unknown } | null | undefined)?.message ?? err ?? '');
  return (
    /dynamically imported module/i.test(msg) || // Chrome: "Failed to fetch dynamically imported module"
    /error loading dynamically imported module/i.test(msg) || // Firefox
    /importing a module script failed/i.test(msg) || // Safari
    /module script/i.test(msg) || // generic "Failed to load module script…"
    /mime type/i.test(msg) // the text/html SPA-fallback MIME rejection
  );
}

/**
 * Decide how to recover from an app-bundle load failure, given whether a
 * reload was already attempted this session. The first chunk-load failure
 * earns a single hard reload; anything after that (or a non-chunk error) gets
 * an actionable message instead of a reload loop.
 */
export function chunkRecoveryAction(
  err: unknown,
  reloadAlreadyAttempted: boolean,
): 'reload' | 'notify' {
  if (isChunkLoadError(err) && !reloadAlreadyAttempted) return 'reload';
  return 'notify';
}
