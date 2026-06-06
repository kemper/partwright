// Singleton registry for the four viewport overlay panels (Paint, Annotate,
// Simplify, Params). Enforces the invariant that at most one is visible at a
// time: opening a new panel automatically closes whatever was previously open.

export interface ViewportPanel {
  close(): void;
}

let active: ViewportPanel | null = null;

/** Call when a panel is about to become visible. Closes any other open panel. */
export function openViewportPanel(panel: ViewportPanel): void {
  if (active && active !== panel) active.close();
  active = panel;
}

/** Call when a panel hides itself (× button, Escape, or forced close). */
export function closeViewportPanel(panel: ViewportPanel): void {
  if (active === panel) active = null;
}
