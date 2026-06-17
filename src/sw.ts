/// <reference lib="webworker" />
//
// Partwright service worker — offline app shell + cross-origin isolation.
//
// This is a single service worker that owns two jobs:
//
//  1. **Offline app shell.** vite-plugin-pwa (injectManifest) replaces
//     `self.__WB_MANIFEST` at build time with the list of hashed build assets.
//     We hand it to Workbox's `precache()` so they're cached on install (and
//     looked up revision-aware via `matchPrecache`) — so a refresh with no
//     network re-boots the editor instead of showing a blank page. (User work
//     already persists in IndexedDB; the local WebLLM model runs with no
//     network — so once the app loads, modeling and local AI keep working.)
//
//  2. **Cross-origin isolation.** The app needs COOP+COEP so SharedArrayBuffer
//     / WASM threads work. In normal operation those headers come from the
//     server (Vite in dev, Cloudflare `public/_headers` in prod). But the
//     top-level *document*, when served from cache offline, needs them re-applied
//     — so we re-stamp COOP/COEP on every navigation response. (Same-origin
//     subresources don't need those headers, so assets are served as-is.) This
//     also makes the worker a fallback for hosts that strip the headers (the old
//     coi-serviceworker role), with a one-time reload driven from registerSW.ts.
//
// Strategy:
//   - Same-origin navigations: network-first (an online user always gets the
//     freshest index.html → latest hashed bundles), falling back to the cached
//     precached shell offline — with COOP/COEP stamped on the way out.
//   - Same-origin static assets: precache-first (revision-aware), then runtime
//     cache, then network with a cache-fill — so the lazy heavy engines
//     (OpenSCAD / replicad WASM, excluded from precache) are cached the first
//     time they're used and available offline thereafter.
//   - Cross-origin (AI / model-download APIs) and non-GET: passthrough; these
//     fail naturally offline.

import { precache, matchPrecache } from 'workbox-precaching';

export {}; // module scope

const sw = self as unknown as ServiceWorkerGlobalScope;

const RUNTIME_CACHE = 'partwright-runtime-v1';

// Whether the page asked us to use COEP: credentialless instead of require-corp
// (set via postMessage from registerSW.ts before the isolation reload).
let coepCredentialless = false;

// Built asset list, injected verbatim at build time by vite-plugin-pwa. Workbox
// precaches these on install and serves them revision-aware via matchPrecache.
precache(self.__WB_MANIFEST);

sw.addEventListener('install', () => {
  sw.skipWaiting();
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      // Drop stale Partwright runtime caches from older versions. Scoped to our
      // own prefix so neither Workbox's precache nor WebLLM's model-weight
      // caches are touched.
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith('partwright-') && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .catch(() => undefined)
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; value?: boolean } | undefined;
  if (!data) return;
  if (data.type === 'coepCredentialless') {
    coepCredentialless = data.value === true;
  }
});

/** Re-stamp COOP/COEP onto a response so the document stays cross-origin
 *  isolated even when served from cache. Returns a fresh Response (single-use
 *  body). */
function stamp(res: Response): Response {
  if (!res || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Cache a successful same-origin runtime response for later offline use.
 *  Fire-and-forget — a storage error must never break the live response. */
function cachePut(request: Request, response: Response): void {
  if (response.status === 200 && response.type === 'basic') {
    const copy = response.clone();
    caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
  }
}

async function handleNavigation(request: Request): Promise<Response> {
  try {
    // Network-first so an online user always boots the freshest build.
    const res = await fetch(request);
    return stamp(res);
  } catch {
    // Offline: serve the precached SPA shell (covers every /editor?… route),
    // re-stamping the isolation headers it needs as the top-level document.
    const shell = (await matchPrecache('index.html')) || (await matchPrecache('/index.html')) || (await caches.match('/index.html'));
    if (shell) return stamp(shell);
    return Response.error();
  }
}

async function handleAsset(request: Request): Promise<Response> {
  // Precache-first (revision-aware via Workbox), then runtime cache. Hashed
  // asset names are immutable, so a cache hit is always safe to serve as-is —
  // and same-origin subresources don't need the COOP/COEP headers.
  const precached = await matchPrecache(request);
  if (precached) return precached;
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    cachePut(request, res);
    return res;
  } catch {
    return Response.error();
  }
}

sw.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;
  // Don't get in the way of cache-only cross-origin probes (upstream guard).
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === sw.location.origin;

  // Cross-origin (AI / model APIs) and non-GET: passthrough, no caching. These
  // are expected to fail offline and surface a real network error.
  if (!sameOrigin || request.method !== 'GET') return;

  event.respondWith(
    request.mode === 'navigate' ? handleNavigation(request) : handleAsset(request),
  );
});
