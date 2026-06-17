// Connectivity awareness.
//
// A tiny wrapper around the browser's online/offline signal so the UI can
// react when the network drops. The app itself keeps working offline — work
// is persisted in IndexedDB, modeling runs entirely in WASM, and the local
// WebLLM model needs no network per turn — but the cloud AI providers
// (Anthropic / OpenAI / Gemini) and model downloads do, so we surface the
// state and steer users toward the local model.
//
// `navigator.onLine` only tells us whether the browser has *any* network
// interface, not whether a given host is reachable; that's fine for our use —
// we use it to explain an obvious offline situation, not to gate requests
// (those still fire and surface their own real error if they fail).

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();

/** Current best-effort connectivity state. Defaults to online when the API is
 *  unavailable (older/headless environments) so behavior is never gated off by
 *  a missing signal. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function emit(): void {
  const online = isOnline();
  for (const fn of listeners) {
    try {
      fn(online);
    } catch {
      // A misbehaving subscriber must not break the others.
    }
  }
}

let installed = false;

/** Subscribe to connectivity changes. Fires immediately with the current state
 *  so callers can render once on subscribe. Returns an unsubscribe function. */
export function onConnectivityChange(fn: Listener): () => void {
  listeners.add(fn);
  if (!installed && typeof window !== 'undefined') {
    installed = true;
    window.addEventListener('online', emit);
    window.addEventListener('offline', emit);
  }
  // Initial sync so subscribers don't have to special-case the first paint.
  try {
    fn(isOnline());
  } catch {
    // ignore
  }
  return () => {
    listeners.delete(fn);
  };
}
