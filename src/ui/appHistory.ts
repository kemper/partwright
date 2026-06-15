// Leaf helper for top-level page/route history. Pure wrappers over the History
// API with no imports, so any module (main.ts, the Sessions modal, …) can push
// the destination history entry *before* a session-mutating call without
// importing main.ts (which would create a cycle).
//
// Why this matters: sessionManager.updateURL() uses history.replaceState, so a
// session switch that doesn't push first silently overwrites the current entry
// and the Back button skips the previous session. See
// CLAUDE.md › "Browser History (Back Button) Preservation".

function currentURLPathAndSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function updateAppHistory(url: string, mode: 'push' | 'replace'): void {
  if (url === currentURLPathAndSearch()) return;
  if (mode === 'push') {
    window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
}
