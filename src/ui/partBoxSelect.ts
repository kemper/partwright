// Shift-click and Shift-drag part selection in the viewport.
//
// With no click-driven tool on, holding Shift turns the left mouse button from
// "orbit/pan the camera" into "select parts":
//   - Shift-click a part to add it to (or take it out of) the selection;
//   - Shift-drag a box to add every part it touches.
// The handler runs in the capture phase on the viewport's container, so the
// camera controls on the canvas never see a Shift-left-drag (Shift-drag used
// to pan; right- or middle-drag still pans).

/** What the box select needs from the app. */
export interface PartBoxSelectDeps {
  canvas: HTMLCanvasElement;
  /** True while a click-driven tool (paint, annotate, arrange, measure…) owns
   *  the viewport — Shift then keeps its usual meaning. */
  isBlocked(): boolean;
  /** The selection key of the part under the pointer, or null. */
  keyAt(e: MouseEvent): string | null;
  /** The keys of the parts with geometry inside the client-space rectangle. */
  keysInRect(rect: { left: number; top: number; right: number; bottom: number }): string[];
  /** Add or remove one key (a Shift-click). */
  toggle(key: string): void;
  /** Add these keys to the selection (a Shift-drag). */
  add(keys: string[]): void;
}

/** Pointer travel (px) under which a Shift-press counts as a click. */
const CLICK_SLOP_PX = 4;

export function installPartBoxSelect(deps: PartBoxSelectDeps): void {
  const container = deps.canvas.parentElement ?? deps.canvas;
  let start: { x: number; y: number; id: number } | null = null;
  let box: HTMLDivElement | null = null;

  const clearBox = () => {
    box?.remove();
    box = null;
  };

  const rectOf = (x: number, y: number) => ({
    left: Math.min(start!.x, x),
    top: Math.min(start!.y, y),
    right: Math.max(start!.x, x),
    bottom: Math.max(start!.y, y),
  });

  container.addEventListener('pointerdown', (e) => {
    if (!e.shiftKey || e.button !== 0 || e.target !== deps.canvas || deps.isBlocked()) return;
    // Keep the camera controls (pointer listeners on the canvas) out of it.
    e.stopPropagation();
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { deps.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }, { capture: true });

  container.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    e.stopPropagation();
    if (!box && Math.hypot(e.clientX - start.x, e.clientY - start.y) < CLICK_SLOP_PX) return;
    if (!box) {
      box = document.createElement('div');
      box.dataset.partBoxSelect = '';
      box.className = 'fixed z-30 pointer-events-none border border-amber-300/80 bg-amber-300/10 rounded-sm';
      document.body.appendChild(box);
    }
    const r = rectOf(e.clientX, e.clientY);
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  }, { capture: true });

  const finish = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    e.stopPropagation();
    try { deps.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const dragged = !!box;
    const r = rectOf(e.clientX, e.clientY);
    start = null;
    clearBox();
    if (e.type === 'pointercancel') return;
    if (dragged) {
      const keys = deps.keysInRect(r);
      if (keys.length > 0) deps.add(keys);
    } else {
      const key = deps.keyAt(e);
      if (key) deps.toggle(key);
    }
  };
  container.addEventListener('pointerup', finish, { capture: true });
  container.addEventListener('pointercancel', finish, { capture: true });
}
