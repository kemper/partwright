// The single statically-loaded module. It does the bare minimum — decide
// whether this navigation is the landing route, then dynamically import the
// matching bundle. Keeping the two as separate dynamic imports lets Vite split
// them, so the landing route never fetches the multi-megabyte app bundle
// (src/main.ts and its Three.js / CodeMirror / manifold graph). The app loads
// only when you navigate into the editor/catalog/etc.
//
// The landing predicate must match shouldShowLanding() in src/main.ts and the
// pre-paint check in public/route-init.js: pathname "/" with no editor view
// state in the query or a share hash.
import { CHUNK_RELOAD_GUARD_KEY, chunkRecoveryAction } from './chunkReload';

function isLandingRoute(): boolean {
  const p = window.location.pathname;
  const q = window.location.search;
  const h = window.location.hash;
  return (
    (p === '/' || p === '') &&
    !h.startsWith('#share=') &&
    q.indexOf('view=') < 0 &&
    q.indexOf('session=') < 0 &&
    q.indexOf('gallery') < 0 &&
    q.indexOf('versions') < 0 &&
    q.indexOf('images') < 0 &&
    q.indexOf('diff') < 0 &&
    q.indexOf('notes') < 0 &&
    q.indexOf('data') < 0
  );
}

function guardAttempted(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === '1';
  } catch {
    return false;
  }
}

function setGuard(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
  } catch {
    /* sessionStorage can be unavailable (private mode, disabled) — no-op */
  }
}

function clearGuard(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
  } catch {
    /* no-op */
  }
}

// Replace the forever-spinning splash with an actionable Reload prompt. Only
// used on app routes (the splash is the active view there); on the landing
// route the static inline HTML stays fully usable, so we don't cover it.
function showReloadPrompt(staleDeploy: boolean): void {
  const splash = document.getElementById('loading-splash');
  if (!splash) return;
  splash.innerHTML = '';
  splash.style.display = 'flex';

  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:16px;max-width:360px;text-align:center;padding:24px;font-family:system-ui,-apple-system,sans-serif';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:24px;font-weight:700;color:#fafafa;letter-spacing:-0.5px';
  title.textContent = 'Partwright';

  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:14px;line-height:1.6;color:#a1a1aa';
  msg.textContent = staleDeploy
    ? 'A new version was deployed while this tab was open, so it couldn’t finish loading. Reload to get the latest build.'
    : 'Something went wrong while loading the app. Reloading usually fixes it.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Reload';
  btn.style.cssText =
    'padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;color:#1c1917;background:linear-gradient(135deg,#fcd34d,#f59e0b);border:0;cursor:pointer';
  btn.addEventListener('click', () => {
    // Manual reload clears the guard so the fresh load gets its own retry budget.
    clearGuard();
    window.location.reload();
  });

  card.append(title, msg, btn);
  splash.appendChild(card);
}

let recovering = false;
function handleLoadFailure(err: unknown, landing: boolean): void {
  if (recovering) return;
  recovering = true;
  console.error('[partwright] Failed to load the app bundle:', err);

  const action = chunkRecoveryAction(err, guardAttempted());
  if (action === 'reload') {
    setGuard();
    // Hard reload — a fresh navigation pulls the new index.html and the chunk
    // hashes that actually exist on the server.
    window.location.reload();
    return;
  }

  // Second failure this session (or a non-chunk error): don't loop. On app
  // routes, swap the spinner for a Reload prompt; on the landing route the
  // static page is still usable, so just leave it.
  if (!landing) showReloadPrompt(isStaleDeploy(err));
}

// chunkRecoveryAction already encodes the chunk-vs-other distinction for the
// action; for messaging we recompute the "stale deploy" flavour cheaply.
function isStaleDeploy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /module|mime type/i.test(msg);
}

// Vite dispatches this on the window when its preload helper fails to fetch a
// dynamic import's dependencies (the other half of the stale-deploy story).
// Preventing default suppresses Vite's own uncaught-error log and routes the
// failure through the same one-time-reload recovery; the import's `.catch`
// below is the backstop for the entry chunk's own load failure.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  handleLoadFailure((event as Event & { payload?: unknown }).payload, isLandingRoute());
});

const landing = isLandingRoute();
const appLoad = landing ? import('./landing/landingEntry') : import('./main');
appLoad
  .then(() => {
    // Successful boot: release the retry budget so a future deploy in this
    // long-lived tab still earns its own one-time auto-reload.
    clearGuard();
  })
  .catch((err: unknown) => handleLoadFailure(err, landing));
