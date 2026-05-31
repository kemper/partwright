// Shared drag-handle logic for viewport overlay panels. Attaches pointer-event
// drag tracking to a handle element and keeps the panel clamped inside the
// visible area of its offset parent. Position resets on each open (not
// persisted) — the panel always starts below the clip-controls toolbar.

/** Position the panel below the #clip-controls toolbar buttons.
 *  Prefers the panel's own offset parent as the coordinate reference so
 *  top/right values land in the correct space. Falls back to clip-controls'
 *  positioned ancestor for callers that position while the panel is hidden
 *  (display:none elements have offsetParent=null). */
export function setInitialPanelPosition(panel: HTMLElement): void {
  const controls = document.getElementById('clip-controls');
  if (controls) {
    const host = (panel.offsetParent ?? controls.offsetParent ?? controls.parentElement) as HTMLElement | null;
    if (host) {
      const cr = controls.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      panel.style.top = `${Math.round(cr.bottom - hr.top + 4)}px`;
      panel.style.right = '8px';
      panel.style.left = 'auto';
      panel.style.bottom = 'auto';
      return;
    }
  }
  // Fallback when clip-controls isn't in the DOM yet.
  panel.style.top = '48px';
  panel.style.right = '8px';
  panel.style.left = 'auto';
  panel.style.bottom = 'auto';
}

export interface PanelDragHandle {
  /** Re-clamp the panel after an external size/position change. */
  clampIntoView(): void;
}

/** Wire up pointer-capture dragging on `handle` to move `panel`.
 *  Buttons inside the handle are excluded from drag initiation so they keep
 *  their click behaviour. Registers a window resize listener for the panel's
 *  lifetime (panels are long-lived singletons, so the listener is never
 *  removed). */
export function attachViewportPanelDrag(
  handle: HTMLElement,
  panel: HTMLElement,
): PanelDragHandle {
  handle.classList.add('cursor-move', 'select-none', 'touch-none');

  let dragPointerId: number | null = null;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function applyPos(left: number, top: number): void {
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function clampIntoView(): void {
    const parent = panel.offsetParent as HTMLElement | null;
    if (!parent || panel.classList.contains('hidden')) return;
    const pad = 8;
    const pr = parent.getBoundingClientRect();
    const rr = panel.getBoundingClientRect();
    if (rr.width === 0 || rr.height === 0) return;
    const visTop = Math.max(pr.top, 0);
    const visBottom = Math.min(pr.bottom, window.innerHeight);
    const visLeft = Math.max(pr.left, 0);
    const visRight = Math.min(pr.right, window.innerWidth);
    const minLeft = (visLeft - pr.left) + pad;
    const minTop = (visTop - pr.top) + pad;
    const maxLeft = (visRight - pr.left) - rr.width - pad;
    const maxTop = (visBottom - pr.top) - rr.height - pad;
    const curLeft = rr.left - pr.left;
    const curTop = rr.top - pr.top;
    const left = Math.max(minLeft, Math.min(curLeft, maxLeft));
    const top = Math.max(minTop, Math.min(curTop, maxTop));
    if (Math.abs(left - curLeft) > 0.5 || Math.abs(top - curTop) > 0.5) {
      applyPos(left, top);
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const parent = panel.offsetParent as HTMLElement | null;
    if (!parent) return;
    const pr = parent.getBoundingClientRect();
    const rr = panel.getBoundingClientRect();
    startLeft = rr.left - pr.left;
    startTop = rr.top - pr.top;
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

  window.addEventListener('resize', () => {
    if (!panel.classList.contains('hidden')) clampIntoView();
  });

  return { clampIntoView };
}
