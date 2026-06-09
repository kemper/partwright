// Shared drag-handle logic for viewport overlay panels. Attaches pointer-event
// drag tracking to a handle element and keeps the panel clamped inside the
// visible browser window. Panels are positioned `fixed` (window-relative) rather
// than absolute within the viewport pane: that lets the user drag them *anywhere*
// in the window, and — crucially — keeps them put when surrounding panes open,
// close, or resize (those reflow the pane but don't move a window-anchored box).
// Position resets on each fresh open (not persisted) — the panel always starts
// docked below the clip-controls toolbar.

// px gap between a docked panel and the bar/menu above it (mirrors the toolbar's
// own right-2 inset, reused as the vertical breathing room under the menu).
const PANEL_EDGE_GAP = 8;

// Keep a dragged panel at least this far from the window edges when re-clamping.
const CLAMP_PAD = 8;

/** The bottom edge (window-relative px) that a docked panel should sit under:
 *  normally the toolbar, but the open horizontal Tools menu when it's showing,
 *  so the panel drops *beneath* the menu row rather than under it. */
function dockUnderBottom(controls: HTMLElement): number {
  const menu = document.getElementById('viewport-tools-menu');
  if (menu && !menu.classList.contains('hidden') && menu.offsetWidth > 0) {
    return menu.getBoundingClientRect().bottom;
  }
  return controls.getBoundingClientRect().bottom;
}

/** Position the panel below the #clip-controls toolbar buttons (or below the
 *  open Tools menu), with its right edge aligned to the toolbar's right edge.
 *  Coordinates are window-relative (the panel is `position: fixed`), so the dock
 *  lands correctly regardless of which pane the toolbar currently lives in. */
export function setInitialPanelPosition(panel: HTMLElement): void {
  panel.style.position = 'fixed';
  const controls = document.getElementById('clip-controls');
  if (controls) {
    const cr = controls.getBoundingClientRect();
    panel.style.top = `${Math.round(dockUnderBottom(controls) + PANEL_EDGE_GAP / 2)}px`;
    // `right` is the gap from the window's right edge to the toolbar's right edge,
    // so the panel tucks under the toolbar even when a docked side panel insets it.
    panel.style.right = `${Math.round(Math.max(PANEL_EDGE_GAP, window.innerWidth - cr.right))}px`;
    panel.style.left = 'auto';
    panel.style.bottom = 'auto';
    return;
  }
  // Fallback when clip-controls isn't in the DOM yet.
  panel.style.top = '48px';
  panel.style.right = `${PANEL_EDGE_GAP}px`;
  panel.style.left = 'auto';
  panel.style.bottom = 'auto';
}

export interface PanelDragHandle {
  /** Re-clamp the panel after an external size/position change. */
  clampIntoView(): void;
  /** Remove the window resize listener. Singleton panels (built once, toggled
   *  via a hidden class) can ignore this; panels that rebuild a fresh element
   *  on every open (Surface, Resize) MUST call it from their close path or each
   *  open/close cycle leaks one listener plus the detached panel it closes over. */
  destroy(): void;
}

/** Wire up pointer-capture dragging on `handle` to move `panel`.
 *  Buttons inside the handle are excluded from drag initiation so they keep
 *  their click behaviour. Registers a window resize listener; long-lived
 *  singleton panels can leave it for the page lifetime, but panels that rebuild
 *  on each open should call the returned `destroy()` on close to release it. */
export function attachViewportPanelDrag(
  handle: HTMLElement,
  panel: HTMLElement,
): PanelDragHandle {
  handle.classList.add('cursor-move', 'select-none', 'touch-none');
  // Window-relative so the panel can be dragged anywhere and stays put when the
  // surrounding panes reflow (see file header).
  panel.style.position = 'fixed';

  let dragPointerId: number | null = null;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function applyPos(left: number, top: number): void {
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  // Pull the panel back inside the window if it would sit (partly) off-screen —
  // e.g. after the window itself is resized smaller. Clamps to the full window,
  // not a parent pane, so the panel is free to live anywhere on screen.
  function clampIntoView(): void {
    if (panel.classList.contains('hidden')) return;
    const rr = panel.getBoundingClientRect();
    if (rr.width === 0 || rr.height === 0) return;
    const maxLeft = window.innerWidth - rr.width - CLAMP_PAD;
    const maxTop = window.innerHeight - rr.height - CLAMP_PAD;
    const left = Math.max(CLAMP_PAD, Math.min(rr.left, maxLeft));
    const top = Math.max(CLAMP_PAD, Math.min(rr.top, maxTop));
    if (Math.abs(left - rr.left) > 0.5 || Math.abs(top - rr.top) > 0.5) {
      applyPos(left, top);
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const rr = panel.getBoundingClientRect();
    startLeft = rr.left;
    startTop = rr.top;
    startX = e.clientX;
    startY = e.clientY;
    dragPointerId = e.pointerId;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (dragPointerId !== e.pointerId) return;
    applyPos(startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
  });

  function endDrag(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return;
    dragPointerId = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    clampIntoView();
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  const onResize = (): void => {
    if (!panel.classList.contains('hidden')) clampIntoView();
  };
  window.addEventListener('resize', onResize);

  return {
    clampIntoView,
    destroy: () => window.removeEventListener('resize', onResize),
  };
}
