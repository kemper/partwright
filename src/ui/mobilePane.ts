// Mobile-only state: which pane (editor or viewport/tabs) is currently
// visible when the layout is stacked vertically. Persisted to localStorage
// so refreshes preserve the user's choice.
//
// Intentionally NOT in the URL: query params are the public contract for
// shared `/editor?session=…` links (see CLAUDE.md "URL State"). A phone user's
// "viewport-only" choice should not propagate to a desktop user opening the
// same link.

export type MobilePane = 'editor' | 'viewport';

const STORAGE_KEY = 'partwright.mobilePane';
const listeners = new Set<(pane: MobilePane) => void>();

let _current: MobilePane = readStored();

function readStored(): MobilePane {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'editor' || stored === 'viewport') return stored;
  } catch {
    // localStorage may be unavailable (private mode, etc.)
  }
  return 'viewport';
}

export function getMobilePane(): MobilePane { return _current; }

export function setMobilePane(pane: MobilePane): void {
  if (_current === pane) return;
  _current = pane;
  try { localStorage.setItem(STORAGE_KEY, pane); } catch { /* ignore */ }
  for (const cb of listeners) cb(pane);
}

export function onMobilePaneChange(cb: (pane: MobilePane) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
