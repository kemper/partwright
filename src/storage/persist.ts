// Persistent-storage request helper.
//
// By default a browser keeps an origin's IndexedDB / Cache / OPFS data in
// "best-effort" storage, which it is free to evict under storage pressure.
// Mobile browsers are far more aggressive here than desktop — iOS Safari in
// particular evicts best-effort storage after ~7 days without a visit (the
// ITP storage cap), which is why saved API keys quietly vanish on mobile but
// almost never on desktop.
//
// `navigator.storage.persist()` asks the browser to mark this origin's storage
// as persistent so it is exempt from that eviction. On Chrome/Android the grant
// is decided silently from engagement heuristics (no prompt); Firefox may
// prompt; iOS Safari grants based on its own heuristics (e.g. installed to the
// home screen). Requesting is harmless everywhere and is the standard mitigation
// for vanishing client-side data.

/** Resolves true once the origin's storage is persistent. */
let granted = false;
/** In-flight request so concurrent callers share one round-trip. */
let inFlight: Promise<boolean> | null = null;

/** Ask the browser to make this origin's storage persistent (eviction-exempt).
 *
 *  Idempotent and cheap to call repeatedly: once a grant succeeds we never
 *  re-request, and concurrent calls share a single round-trip. A *denied*
 *  request is NOT cached, so a later call (e.g. after the user saves a key and
 *  engagement is higher) can succeed where an earlier one failed. Soft-fails on
 *  browsers without the Storage API, so callers can fire-and-forget. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (granted) return true;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.storage?.persist) return false;
    try {
      // Already persistent (e.g. granted in a previous session)? Don't re-ask.
      if (nav.storage.persisted && (await nav.storage.persisted())) {
        granted = true;
        return true;
      }
      const ok = await nav.storage.persist();
      if (ok) granted = true;
      return ok;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
