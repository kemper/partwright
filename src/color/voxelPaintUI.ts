// Voxel Studio UI — a self-contained overlay button + floating panel that only
// appears in voxel-language sessions. Kept separate from paintUI.ts (which is
// geared around triangle/region painting of solid models) because the voxel
// workflow is genuinely different: pick a tool, click faces to add/remove/
// recolor cubes, undo/redo, then "bake" commits the edited grid back to code.

import * as voxelPaint from './voxelPaint';
import type { VoxelTool } from './voxelPaint';

const SWATCHES: string[] = [
  '#ff3b30', '#ff8c42', '#ffd60a', '#34c759', '#5ac8fa',
  '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#1c1c1e',
];

// Tool buttons, in panel order. `label` is the glyph shown; `title` the tooltip.
const TOOLS: { tool: VoxelTool; label: string; title: string }[] = [
  { tool: 'paint',     label: '🖌', title: 'Paint — recolor the clicked voxel' },
  { tool: 'add',       label: '➕', title: 'Add — place a new cube on the clicked face' },
  { tool: 'remove',    label: '⌫',  title: 'Remove — delete the clicked voxel' },
  { tool: 'bucket',    label: '🪣', title: 'Bucket — recolor the connected same-color region' },
  { tool: 'boxAdd',    label: '⬚➕', title: 'Box fill — click two corners to fill a region' },
  { tool: 'boxRemove', label: '⬚⌫',  title: 'Box subtract — click two corners to carve a region out' },
];

let paintBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let onActivate: (() => Promise<void> | void) | null = null;
let onDeactivate: (() => Promise<void> | void) | null = null;
let onBake: (() => Promise<void> | void) | null = null;
let active = false;
let currentColor = SWATCHES[0];

// Live element refs so syncActiveState can refresh tool/undo/count state.
let toolBtns: Partial<Record<VoxelTool, HTMLButtonElement>> = {};
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let statusEl: HTMLElement | null = null;

export interface VoxelPaintUICallbacks {
  /** Called when the user clicks the toggle button to enter the studio. The
   *  main app is responsible for calling `voxelPaint.activate(...)` (so the
   *  callback can stitch in the editor lock + mesh updater). */
  activate: () => Promise<void> | void;
  /** Called to cancel editing without committing. */
  deactivate: () => Promise<void> | void;
  /** Called to bake the edited grid into code + save a new version. */
  bake: () => Promise<void> | void;
}

/** Mount the Voxel Studio button into the viewport's controls container.
 *  Hidden unless `setVoxelPaintAvailable(true)` is called (the host wires this
 *  to the language being 'voxel'). */
export function initVoxelPaintUI(controlsContainer: HTMLElement, callbacks: VoxelPaintUICallbacks): void {
  onActivate = callbacks.activate;
  onDeactivate = callbacks.deactivate;
  onBake = callbacks.bake;

  paintBtn = document.createElement('button');
  paintBtn.id = 'voxel-paint-toggle';
  paintBtn.className = 'hidden px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  paintBtn.textContent = '🧊 Voxel Studio';
  paintBtn.title = 'Add, remove, and recolor voxels — then bake to code.';
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
  // If we're leaving voxel sessions while the studio is active, force-cancel.
  if (!available && active) void doDeactivate();
}

/** Reflect the engine's active state on the toggle button + panel. Called by
 *  the host whenever the studio activates/deactivates/edits from any source. */
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
  refreshControls();
}

/** Refresh tool highlight, undo/redo enablement, and the status line. */
function refreshControls(): void {
  const tool = voxelPaint.getTool();
  for (const t of TOOLS) {
    const btn = toolBtns[t.tool];
    if (!btn) continue;
    const on = t.tool === tool;
    btn.classList.toggle('bg-emerald-600', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('border-emerald-400', on);
  }
  if (undoBtn) undoBtn.disabled = !voxelPaint.canUndo();
  if (redoBtn) redoBtn.disabled = !voxelPaint.canRedo();
  if (statusEl) {
    const count = voxelPaint.voxelCount();
    const pending = voxelPaint.pendingBoxCorner();
    statusEl.textContent = pending
      ? 'Box: click the opposite corner'
      : `${count.toLocaleString()} voxel${count === 1 ? '' : 's'}`;
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
  // Seed the engine with the currently-selected color + default tool.
  if (active) { voxelPaint.setColor(currentColor); voxelPaint.setTool('paint'); refreshControls(); }
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
  p.style.minWidth = '200px';

  const title = document.createElement('div');
  title.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  title.textContent = 'Voxel Studio';
  p.appendChild(title);

  // Tool selector.
  toolBtns = {};
  const tools = document.createElement('div');
  tools.className = 'grid grid-cols-3 gap-1';
  for (const t of TOOLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tool = t.tool;
    btn.className = 'px-1 py-1 rounded text-sm border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
    btn.textContent = t.label;
    btn.title = t.title;
    btn.addEventListener('click', () => { voxelPaint.setTool(t.tool); refreshControls(); });
    tools.appendChild(btn);
    toolBtns[t.tool] = btn;
  }
  p.appendChild(tools);

  // Color swatch grid + custom color.
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-5 gap-1';
  let activeSwatch: HTMLButtonElement | null = null;
  const selectColor = (hex: string, sw: HTMLButtonElement | null) => {
    currentColor = hex;
    voxelPaint.setColor(hex);
    if (activeSwatch) activeSwatch.classList.remove('ring-2', 'ring-white');
    if (sw) { sw.classList.add('ring-2', 'ring-white'); activeSwatch = sw; }
  };
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'w-6 h-6 rounded border border-zinc-600/60 hover:border-zinc-300 transition-colors';
    sw.style.backgroundColor = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      selectColor(hex, sw);
      // Picking a color while on an eraser/remove tool means "I want to draw" —
      // hop to paint so the next click colors rather than deletes.
      if (voxelPaint.getTool() === 'remove' || voxelPaint.getTool() === 'boxRemove') {
        voxelPaint.setTool('paint');
      }
      refreshControls();
    });
    grid.appendChild(sw);
    if (hex === currentColor) { sw.classList.add('ring-2', 'ring-white'); activeSwatch = sw; }
  }
  p.appendChild(grid);

  // Custom color picker — any RGB, not just the 10 swatches.
  const customRow = document.createElement('label');
  customRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = '#ffaa00';
  customInput.className = 'w-6 h-6 rounded border border-zinc-600/60 bg-transparent cursor-pointer';
  customInput.title = 'Custom color';
  customInput.addEventListener('input', () => {
    selectColor(customInput.value, null);
    if (voxelPaint.getTool() === 'remove' || voxelPaint.getTool() === 'boxRemove') voxelPaint.setTool('paint');
    refreshControls();
  });
  customRow.appendChild(customInput);
  const customLabel = document.createElement('span');
  customLabel.textContent = 'Custom color';
  customRow.appendChild(customLabel);
  p.appendChild(customRow);

  // Undo / redo + status.
  const histRow = document.createElement('div');
  histRow.className = 'flex items-center gap-1';
  undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  undoBtn.textContent = '↺ Undo';
  undoBtn.title = 'Undo the last edit';
  undoBtn.addEventListener('click', () => { voxelPaint.undo(); refreshControls(); });
  histRow.appendChild(undoBtn);
  redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  redoBtn.textContent = '↻ Redo';
  redoBtn.title = 'Redo the last undone edit';
  redoBtn.addEventListener('click', () => { voxelPaint.redo(); refreshControls(); });
  histRow.appendChild(redoBtn);
  statusEl = document.createElement('span');
  statusEl.className = 'ml-auto text-[11px] text-zinc-500';
  histRow.appendChild(statusEl);
  p.appendChild(histRow);

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
  cancelBtn.title = 'Discard edits and unlock the editor';
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
