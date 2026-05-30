// A preference that is independent per browser tab, but seeds a fresh tab from
// a shared "last used" default.
//
// The problem it solves: a preference kept in a single shared localStorage key
// silently changes across windows. Two tabs open side by side snapshot the key
// at load and never converge; worse, changing it in one tab retroactively
// alters another tab the next time that tab reads/reloads — a cross-tab side
// effect the user never asked for (the same class of bug as the AI-provider
// leak). For app-level preferences (units, render quality, editor auto-format)
// we want: each open tab is independent (no live bleed between windows), but a
// brand-new tab still inherits your most recent choice.
//
// Implementation: the live value lives in sessionStorage (scoped to one tab,
// survives reload of that tab, never shared and never fires `storage` events in
// other tabs). localStorage holds only the "default for the next fresh tab"
// seed. We never attach a `storage` listener, so a peer tab's write is never
// adopted by an already-open tab. Both stores are accessed defensively so this
// is safe in a Worker or private-mode context (both globals may be absent),
// where it simply reports "no stored value" and callers fall back to defaults.
//
// Use this for genuinely app-level preferences. State that belongs to a session
// (e.g. the AI provider/model/toggles) goes on the session record instead, so
// it carries over only on the explicit open / take-control transitions.

/** Read the per-tab value, falling back to the shared default seed for a fresh
 *  tab. Returns null when neither store has it (or storage is unavailable). */
export function readPerTabPref(key: string): string | null {
  try {
    const perTab = sessionStorage.getItem(key);
    if (perTab !== null) return perTab;
  } catch {
    // sessionStorage unavailable (Worker / private mode) — try the seed.
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write the per-tab value AND refresh the shared default seed. The seed only
 *  affects tabs opened *after* this write — already-open tabs keep their own
 *  per-tab value and never adopt this change live. */
export function writePerTabPref(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* best-effort */ }
  try { localStorage.setItem(key, value); } catch { /* best-effort */ }
}
