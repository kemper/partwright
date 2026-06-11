// Service-worker registration.
//
// Registers the offline/isolation service worker (`/sw.js`, built from
// `src/sw.ts` by vite-plugin-pwa). Registration is unconditional in a secure
// context — the worker's main value is the offline app-shell cache, which is
// needed even when the server is already delivering COOP/COEP. It supersedes
// the old coi-serviceworker.js (which only registered when the page *wasn't*
// cross-origin isolated, so its caching never ran in normal operation).
//
// Production-only: in dev the SW is intentionally not built/served (it would
// fight Vite's module pipeline / HMR), and dev gets COOP/COEP straight from the
// Vite server, so isolation works without it. Guarding on import.meta.env.PROD
// keeps the dev server and the e2e suite (which runs against it) SW-free.
//
// Cross-origin-isolation fallback: when a host fails to send COOP/COEP, the
// first load isn't isolated and the worker isn't controlling yet. Once it
// activates and claims the page, a single reload lets it serve the document
// with stamped headers — the same one-time-reload dance the old shim did. When
// the server already sends the headers (the normal case here), the page is
// isolated on first load and no reload happens.

// Distinct from main.ts's 'partwright-coi-waited' (which records that the editor
// already *waited* for a reload): this flag records that *we already triggered*
// the one-time isolation reload, so the two never deadlock on a shared key.
const COI_RELOAD_FLAG = 'partwright-sw-coi-reloaded';

function maybeReloadForIsolation(registration?: ServiceWorkerRegistration): void {
  try {
    // Already isolated (server sent the headers) — nothing to do.
    if (self.crossOriginIsolated !== false) return;
    // Only reload once per tab so we never loop on a host that truly can't be
    // isolated (the editor then surfaces its own "not cross-origin isolated"
    // message instead of reloading forever).
    if (sessionStorage.getItem(COI_RELOAD_FLAG) === '1') return;
    // Reload once a worker exists that can serve a stamped document on the next
    // navigation. Accept `registration.active` as well as a live controller:
    // on a fast first install the worker can already be active before the
    // updatefound/statechange listener is attached, and a reload then lets the
    // (about-to-control) worker isolate the page.
    const hasWorker = !!navigator.serviceWorker.controller || !!registration?.active;
    if (!hasWorker) return;
    sessionStorage.setItem(COI_RELOAD_FLAG, '1');
    window.location.reload();
  } catch {
    // sessionStorage unavailable — skip the reload rather than risk a loop.
  }
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      // Tell an already-active worker which COEP mode to stamp, then check
      // whether we need the one-time isolation reload.
      navigator.serviceWorker.controller?.postMessage({ type: 'coepCredentialless', value: false });
      maybeReloadForIsolation(registration);

      // On first install there's no controller yet; reload once it activates so
      // it can serve a stamped, isolated document (only matters if the server
      // didn't already send the headers).
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'activated') maybeReloadForIsolation(registration);
        });
      });
    })
    .catch(() => {
      // Registration failure is non-fatal: the server-sent COOP/COEP headers
      // still isolate the page; we just lose the offline cache.
    });
}
