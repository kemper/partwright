// Voxel paint UI — a small, self-contained overlay button + floating panel
// that only appears in voxel-language sessions. Kept separate from paintUI.ts
// (which is geared around triangle/region painting of solid models) because
// the voxel workflow is genuinely different: click one face → set/erase one
// voxel; the editor locks until "Bake" commits the painted grid back to code.

import * as voxelPaint from './voxelPaint';

const SWATCHES: string[] = [
  '#ff3b30', '#ff8c42', '#ffd60a', '#34c759', '#5ac8fa',
  '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#1c1c1e',
];

let paintBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let onActivate: (() => Promise<void> | void) | null = null;
let onDeactivate: (() => Promise<void> | void) | null = null;
let onBake: (() => Promise<void> | void) | null = null;
let active = false;
let currentColor = SWATCHES[0];

export interface VoxelPaintUICallbacks {
  /** Called when the user clicks the toggle button to enter voxel paint. The
   *  main app is responsible for calling `voxelPaint.activate(...)` (so the
   *  callback can stitch in the editor lock + mesh updater). */
  activate: () => Promise<void> | void;
  /** Called to cancel paint without committing. */
  deactivate: () => Promise<void> | void;
  /** Called to bake the painted grid into code + save a new version. */
  bake: () => Promise<void> | void;
}

/** Mount the voxel-paint button into the viewport's controls container.
 *  Hidden unless `setVisible(true)` is called (the host wires this to the
 *  language being 'voxel'). */
export function initVoxelPaintUI(controlsContainer: HTMLElement, callbacks: VoxelPaintUICallbacks): void {
  onActivate = callbacks.activate;
  onDeactivate = callbacks.deactivate;
  onBake = callbacks.bake;

  paintBtn = document.createElement('button');
  paintBtn.id = 'voxel-paint-toggle';
  paintBtn.className = 'hidden px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  paintBtn.textContent = '🎨 Voxel paint';
  paintBtn.title = 'Click a face to set that voxel\'s color. Bake to commit.';
  paintBtn.addEventListener('click', toggle);

  // Slot next to the existing paint button so the two read as related.
  const sibling = controlsContainer.querySelector('#paint-toggle');
  if (sibling) controlsContainer.insertBefore(paintBtn, sibling);
  else controlsContainer.appendChild(paintBtn);

  panel = createPanel();
  // Anchor to the positioned viewport pane (same trick paintUI uses).
  const positionedAncestor = findPositionedAncestor(controlsContainer);
  (positionedAncestor ?? document.body).appendChild(panel);
}

/** Toggle button visibility based on whether the active language is voxel. */
export function setVoxelPaintAvailable(available: boolean): void {
  if (!paintBtn) return;
  paintBtn.classList.toggle('hidden', !available);
  // If we're leaving voxel sessions while paint is active, force-cancel.
  if (!available && active) void doDeactivate();
}

/** Reflect the engine's active state on the toggle button. Called by the
 *  host whenever voxel-paint activates/deactivates from any source. */
export function syncActiveState(): void {
  active = voxelPaint.isActive();
  if (!paintBtn || !panel) return;
  if (active) {
    paintBtn.classList.add('bg-emerald-700/60', 'text-emerald-100', 'border-emerald-500/50');
    paintBtn.classList.remove('text-zinc-400');
    panel.classList.remove('hidden');
  } else {
    paintBtn.classList.remove('bg-emerald-700/60', 'text-emerald-100', 'border-emerald-500/50');
    paintBtn.classList.add('text-zinc-400');
    panel.classList.add('hidden');
  }
}

async function toggle(): Promise<void> {
  if (active) await doDeactivate();
  else await doActivate();
}

async function doActivate(): Promise<void> {
  if (!onActivate) return;
  await onActivate();
  syncActiveState();
  // Seed the engine with the currently-selected color.
  if (active) voxelPaint.setColor(currentColor);
}

async function doDeactivate(): Promise<void> {
  if (!onDeactivate) return;
  await onDeactivate();
  syncActiveState();
}

function createPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'voxel-paint-panel';
  p.className = 'hidden absolute top-12 left-3 z-20 p-2 rounded-lg bg-zinc-900/95 backdrop-blur border border-zinc-700 shadow-xl text-xs text-zinc-200 flex flex-col gap-2';
  p.style.minWidth = '180px';

  const title = document.createElement('div');
  title.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  title.textContent = 'Voxel paint';
  p.appendChild(title);

  // Color swatch grid.
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-5 gap-1';
  let activeSwatch: HTMLButtonElement | null = null;
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'w-6 h-6 rounded border border-zinc-600/60 hover:border-zinc-300 transition-colors';
    sw.style.backgroundColor = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      currentColor = hex;
      voxelPaint.setColor(hex);
      voxelPaint.setEraser(false);
      if (activeSwatch) activeSwatch.classList.remove('ring-2', 'ring-white');
      sw.classList.add('ring-2', 'ring-white');
      activeSwatch = sw;
      eraserBtn.classList.remove('bg-zinc-700');
    });
    grid.appendChild(sw);
    if (hex === currentColor) {
      sw.classList.add('ring-2', 'ring-white');
      activeSwatch = sw;
    }
  }
  p.appendChild(grid);

  const eraserBtn = document.createElement('button');
  eraserBtn.type = 'button';
  eraserBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
  eraserBtn.textContent = '⌫ Eraser';
  eraserBtn.title = 'Click a face to remove that voxel';
  eraserBtn.addEventListener('click', () => {
    const next = !voxelPaint.isEraser();
    voxelPaint.setEraser(next);
    eraserBtn.classList.toggle('bg-zinc-700', next);
  });
  p.appendChild(eraserBtn);

  const actions = document.createElement('div');
  actions.className = 'flex gap-1 pt-1 border-t border-zinc-700/60';

  const bakeBtn = document.createElement('button');
  bakeBtn.type = 'button';
  bakeBtn.className = 'flex-1 px-2 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 text-white transition-colors';
  bakeBtn.textContent = 'Bake → code';
  bakeBtn.title = 'Replace the editor with voxels.decode(...) and save a new version';
  bakeBtn.addEventListener('click', async () => { if (onBake) await onBake(); syncActiveState(); });
  actions.appendChild(bakeBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.title = 'Discard painted voxels and unlock the editor';
  cancelBtn.addEventListener('click', () => { void doDeactivate(); });
  actions.appendChild(cancelBtn);

  p.appendChild(actions);
  return p;
}

function findPositionedAncestor(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const pos = getComputedStyle(cur).position;
    if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') return cur;
    cur = cur.parentElement;
  }
  return null;
}
