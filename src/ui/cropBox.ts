// Drag-to-crop box over an image thumbnail: drag the rectangle to move it, the
// eight handles to resize. The crop is a normalised 0..1 box over the image's
// natural size (`CropRect`), so it survives resolution changes. Shared by the
// relief wizard and the Image tools panel's image prep (#1256) — extracted
// from the wizard so the two can't drift.
//
// Pointer Events + `touch-none` so mouse, touch and stylus all drag; the
// handles are small visually but the move target is the whole rectangle.

import type { CropRect } from '../relief/types';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Clamp a crop in place to 0..1 with a 5% minimum edge. With `lockAspect`
 *  (width/height in image pixels) the height follows the width, keeping the
 *  vertical centre where possible. `naturalAspect` = image width / height. */
export function clampCropRect(c: CropRect, lockAspect: number | null, naturalAspect: number): void {
  const minSize = 0.05; // never let crop shrink below 5% of an edge
  c.left = Math.max(0, Math.min(1 - minSize, c.left));
  c.top = Math.max(0, Math.min(1 - minSize, c.top));
  c.right = Math.max(c.left + minSize, Math.min(1, c.right));
  c.bottom = Math.max(c.top + minSize, Math.min(1, c.bottom));
  if (lockAspect) {
    // The box is in fractions, so convert through the natural aspect.
    const targetHFrac = ((c.right - c.left) * naturalAspect) / lockAspect;
    const cy = (c.top + c.bottom) / 2;
    let top = cy - targetHFrac / 2;
    let bot = cy + targetHFrac / 2;
    if (top < 0) { top = 0; bot = targetHFrac; }
    if (bot > 1) { bot = 1; top = 1 - targetHFrac; }
    c.top = Math.max(0, top);
    c.bottom = Math.min(1, bot);
  }
}

export interface CropBoxOptions {
  /** The crop being edited; the box mutates the returned object in place. */
  getCrop: () => CropRect;
  /** Natural image width / height (for the aspect lock); 1 when unknown. */
  getNaturalAspect: () => number;
  /** Lock the crop to this pixel aspect (e.g. 1 for a circular tile), or null. */
  getAspectLock?: () => number | null;
  /** Fired on every drag step after the crop changed. */
  onChange: () => void;
  /** Display width of the thumbnail in CSS px (default 200). */
  widthPx?: number;
  heading?: string;
}

export interface CropBox {
  /** Root element (heading + thumbnail). */
  el: HTMLDivElement;
  /** The thumbnail image — set its `src` to the source image. */
  img: HTMLImageElement;
  /** Re-position the rectangle from the current crop. */
  render(): void;
}

export function createCropBox(o: CropBoxOptions): CropBox {
  const el = document.createElement('div');
  el.className = 'flex flex-col items-center gap-1';
  const heading = document.createElement('div');
  heading.className = 'text-[10px] text-zinc-500 font-mono self-start';
  heading.textContent = o.heading ?? 'Crop · drag corners to resize';
  const container = document.createElement('div');
  container.className = 'relative select-none touch-none rounded border border-zinc-700 overflow-hidden bg-zinc-900';
  const w = o.widthPx ?? 200;
  container.style.maxWidth = '100%';
  container.style.width = `${w}px`;
  const img = document.createElement('img');
  img.className = 'block w-full h-auto pointer-events-none';
  img.draggable = false;
  img.alt = '';
  container.appendChild(img);
  // Four dim panels shade the parts of the image being cropped away.
  const dimTop = document.createElement('div');
  const dimRight = document.createElement('div');
  const dimBottom = document.createElement('div');
  const dimLeft = document.createElement('div');
  for (const d of [dimTop, dimRight, dimBottom, dimLeft]) {
    d.className = 'absolute bg-black/55 pointer-events-none';
    container.appendChild(d);
  }
  const rect = document.createElement('div');
  rect.className = 'absolute border-2 border-white/90 cursor-move shadow-[0_0_0_1px_rgba(0,0,0,0.4)]';
  rect.setAttribute('data-crop-rect', '');
  container.appendChild(rect);
  // 8 handles: 4 corners + 4 edge midpoints; data-edge says which sides move.
  const handles: Partial<Record<Edge, HTMLElement>> = {};
  const handleStyle = 'absolute w-3 h-3 -mt-1.5 -ml-1.5 rounded-sm bg-white/95 border border-zinc-700';
  const edgeCursor: Record<Edge, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
  for (const e of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Edge[]) {
    const h = document.createElement('div');
    h.className = handleStyle;
    h.style.cursor = edgeCursor[e];
    h.dataset.edge = e;
    handles[e] = h;
    rect.appendChild(h);
  }
  el.append(heading, container);

  function render(): void {
    const c = o.getCrop();
    const lpct = c.left * 100;
    const tpct = c.top * 100;
    const wpct = (c.right - c.left) * 100;
    const hpct = (c.bottom - c.top) * 100;
    rect.style.left = `${lpct}%`;
    rect.style.top = `${tpct}%`;
    rect.style.width = `${wpct}%`;
    rect.style.height = `${hpct}%`;
    dimTop.style.left = '0'; dimTop.style.top = '0'; dimTop.style.width = '100%'; dimTop.style.height = `${tpct}%`;
    dimBottom.style.left = '0'; dimBottom.style.top = `${tpct + hpct}%`; dimBottom.style.width = '100%'; dimBottom.style.height = `${100 - (tpct + hpct)}%`;
    dimLeft.style.left = '0'; dimLeft.style.top = `${tpct}%`; dimLeft.style.width = `${lpct}%`; dimLeft.style.height = `${hpct}%`;
    dimRight.style.left = `${lpct + wpct}%`; dimRight.style.top = `${tpct}%`; dimRight.style.width = `${100 - (lpct + wpct)}%`; dimRight.style.height = `${hpct}%`;
    const pos: Record<Edge, [string, string]> = { nw: ['0%', '0%'], ne: ['100%', '0%'], sw: ['0%', '100%'], se: ['100%', '100%'], n: ['50%', '0%'], s: ['50%', '100%'], w: ['0%', '50%'], e: ['100%', '50%'] };
    for (const [edge, [l, t]] of Object.entries(pos) as Array<[Edge, [string, string]]>) {
      const h = handles[edge];
      if (h) { h.style.left = l; h.style.top = t; }
    }
  }

  // Drag in normalised crop space.
  let drag: { kind: 'move' | 'resize'; edge?: Edge; startX: number; startY: number; orig: CropRect } | null = null;
  function start(e: PointerEvent, kind: 'move' | 'resize', edge?: Edge): void {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag = { kind, edge, startX: e.clientX, startY: e.clientY, orig: { ...o.getCrop() } };
  }
  function move(e: PointerEvent): void {
    if (!drag) return;
    const r = container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dxN = (e.clientX - drag.startX) / r.width;
    const dyN = (e.clientY - drag.startY) / r.height;
    const c = o.getCrop();
    const og = drag.orig;
    if (drag.kind === 'move') {
      const cw = og.right - og.left;
      const ch = og.bottom - og.top;
      c.left = og.left + dxN;
      c.top = og.top + dyN;
      c.right = c.left + cw;
      c.bottom = c.top + ch;
      // Moving never resizes.
      if (c.left < 0) { c.right -= c.left; c.left = 0; }
      if (c.top < 0) { c.bottom -= c.top; c.top = 0; }
      if (c.right > 1) { c.left -= (c.right - 1); c.right = 1; }
      if (c.bottom > 1) { c.top -= (c.bottom - 1); c.bottom = 1; }
    } else if (drag.edge) {
      const edge = drag.edge;
      if (edge.includes('n')) c.top = og.top + dyN;
      if (edge.includes('s')) c.bottom = og.bottom + dyN;
      if (edge.includes('w')) c.left = og.left + dxN;
      if (edge.includes('e')) c.right = og.right + dxN;
      clampCropRect(c, o.getAspectLock?.() ?? null, o.getNaturalAspect());
    }
    render();
    o.onChange();
  }
  function end(e: PointerEvent): void {
    if (!drag) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag = null;
  }
  rect.addEventListener('pointerdown', (e) => {
    const edge = (e.target as HTMLElement).dataset.edge as Edge | undefined;
    if (edge) start(e, 'resize', edge);
    else start(e, 'move');
  });
  rect.addEventListener('pointermove', move);
  rect.addEventListener('pointerup', end);
  rect.addEventListener('pointercancel', end);

  return { el, img, render };
}
