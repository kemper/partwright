// Singleton registry for the four viewport overlay panels (Paint, Annotate,
// Simplify, Params). Enforces the invariant that at most one is visible at a
// time: opening a new panel automatically closes whatever was previously open.

export interface ViewportPanel {
  close(): void;
}

let active: ViewportPanel | null = null;

type OpenListener = () => void;
const openListeners: OpenListener[] = [];

/**
 * Subscribe to "a viewport tool panel just opened". Used to step the AI panel
 * out of the way when the user reaches for a hands-on tool (Paint, Customize,
 * Surface, …). Kept as a listener so this module stays a dependency-free leaf
 * rather than importing the AI panel and risking a cycle — the subscriber is
 * wired in `main.ts`.
 */
export function onViewportPanelOpen(fn: OpenListener): void {
  openListeners.push(fn);
}

/** Call when a panel is about to become visible. Closes any other open panel.
 *
 *  `silent` opens (e.g. the Customizer auto-revealing after an AI turn) skip the
 *  open-listeners, so they don't pull the AI panel out of the way — only a
 *  hands-on, user-initiated tool open should do that. */
export function openViewportPanel(panel: ViewportPanel, opts?: { silent?: boolean }): void {
  if (active && active !== panel) active.close();
  const reopening = active === panel;
  active = panel;
  // Notify subscribers only on a genuine, non-silent open (a panel re-asserting
  // itself — e.g. a params re-sync on the already-open panel — shouldn't keep
  // stomping the AI panel the user may have just reopened).
  if (!reopening && !opts?.silent) for (const fn of openListeners) fn();
}

/** Call when a panel hides itself (× button, Escape, or forced close). */
export function closeViewportPanel(panel: ViewportPanel): void {
  if (active === panel) active = null;
}

/** The viewport tool panel currently open ("the current menu"), or `null` if
 *  none. Lets a panel about to auto-open check whether the user already has a
 *  *different* menu open and defer to it (see the Customizer's part-switch
 *  auto-reveal). */
export function getActiveViewportPanel(): ViewportPanel | null {
  return active;
}
