// Voxel Studio UI — a self-contained overlay button + floating panel that only
// appears in voxel-language sessions. It mirrors the main Paint menu's layout
// (tool row → color → conditional brush section → conditional level/axis →
// history → actions) but operates on the voxel grid: pick a tool, drag faces to
// add/remove/recolor cubes, then "bake" commits the edited grid back to code.

import * as voxelPaint from './voxelPaint';
import type { VoxelTool, BrushShape } from './voxelPaint';

const SWATCHES: string[] = [
  '#ff3b30', '#ff8c42', '#ffd60a', '#34c759', '#5ac8fa',
  '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#1c1c1e',
];

// Tool buttons, in panel order. `label` is the glyph shown; `title` the tooltip.
const TOOLS: { tool: VoxelTool; label: string; title: string }[] = [
  { tool: 'paint',     label: '🖌', title: 'Brush — drag to recolor voxels (use Size for a wider brush)' },
  { tool: 'add',       label: '➕', title: 'Add — drag to build cubes onto the clicked faces' },
  { tool: 'remove',    label: '⌫',  title: 'Remove — drag to delete voxels' },
  { tool: 'bucket',    label: '🪣', title: 'Bucket — recolor the connected same-color region' },
  { tool: 'level',     label: '🧱', title: 'Level — recolor a whole X/Y/Z layer through the clicked voxel' },
  { tool: 'boxAdd',    label: '⬚➕', title: 'Box fill — click two voxels to fill the box between them' },
  { tool: 'boxRemove', label: '⬚⌫',  title: 'Box subtract — click two voxels to carve out the box between them' },
];

const BRUSH_SHAPES: { shape: BrushShape; label: string; title: string }[] = [
  { shape: 'sphere',  label: '●', title: 'Round brush (sphere)' },
  { shape: 'cube',    label: '◻', title: 'Square brush (cube)' },
  { shape: 'diamond', label: '◆', title: 'Diamond brush (octahedron)' },
];

const AXES: { axis: 0 | 1 | 2; label: string }[] = [
  { axis: 0, label: 'X' }, { axis: 1, label: 'Y' }, { axis: 2, label: 'Z' },
];

let paintBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let onActivate: (() => Promise<void> | void) | null = null;
let onDeactivate: (() => Promise<void> | void) | null = null;
let onBake: (() => Promise<void> | void) | null = null;
let active = false;
let currentColor = SWATCHES[0];

// Live element refs so refreshControls can reflect engine state in the panel.
let toolBtns: Partial<Record<VoxelTool, HTMLButtonElement>> = {};
let shapeBtns: Partial<Record<BrushShape, HTMLButtonElement>> = {};
let axisBtns: Partial<Record<number, HTMLButtonElement>> = {};
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let statusEl: HTMLElement | null = null;
let brushSection: HTMLElement | null = null;
let levelSection: HTMLElement | null = null;
let sizeSlider: HTMLInputElement | null = null;
let sizeLabel: HTMLElement | null = null;
let sprayBtn: HTMLButtonElement | null = null;
let sprayRow: HTMLElement | null = null;

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

/** Mount the Voxel Studio button into the viewport's controls container. */
export function initVoxelPaintUI(controlsContainer: HTMLElement, callbacks: VoxelPaintUICallbacks): void {
  onActivate = callbacks.activate;
  onDeactivate = callbacks.deactivate;
  onBake = callbacks.bake;

  paintBtn = document.createElement('button');
  paintBtn.id = 'voxel-paint-toggle';
  paintBtn.className = 'hidden px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  paintBtn.textContent = '🧊 Voxel Studio';
  paintBtn.title = 'Add, remove, brush, and recolor voxels — then bake to code.';
  paintBtn.addEventListener('click', toggle);

  // Slot next to the existing paint button so the two read as related.
  const sibling = controlsContainer.querySelector('#paint-toggle');
  if (sibling) controlsContainer.insertBefore(paintBtn, sibling);
  else controlsContainer.appendChild(paintBtn);

  panel = createPanel();
  const positionedAncestor = findPositionedAncestor(controlsContainer);
  (positionedAncestor ?? document.body).appendChild(panel);
}

/** Toggle button visibility based on whether the active language is voxel. */
export function setVoxelPaintAvailable(available: boolean): void {
  if (!paintBtn) return;
  paintBtn.classList.toggle('hidden', !available);
  if (!available && active) void doDeactivate();
}

/** Reflect the engine's active state on the toggle button + panel. */
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

/** Refresh tool/shape/axis highlight, conditional sections, brush readout,
 *  undo/redo enablement, and the status line. */
function refreshControls(): void {
  const tool = voxelPaint.getTool();
  for (const t of TOOLS) setActive(toolBtns[t.tool], t.tool === tool);

  // Brush section shows only for the brush tools; level section only for level.
  const brushy = tool === 'paint' || tool === 'add' || tool === 'remove';
  brushSection?.classList.toggle('hidden', !brushy);
  levelSection?.classList.toggle('hidden', tool !== 'level');

  for (const s of BRUSH_SHAPES) setActive(shapeBtns[s.shape], s.shape === voxelPaint.getBrushShape());
  for (const a of AXES) setActive(axisBtns[a.axis], a.axis === voxelPaint.getLevelAxis());

  if (sizeSlider) sizeSlider.value = String(voxelPaint.getBrushRadius());
  if (sizeLabel) {
    const r = voxelPaint.getBrushRadius();
    sizeLabel.textContent = r === 0 ? 'Size: 1 voxel' : `Size: ${r * 2 + 1} wide`;
  }
  if (sprayBtn) {
    const on = voxelPaint.isSpray();
    sprayBtn.textContent = on ? '◉ Spray: on' : '○ Spray: off';
    setActive(sprayBtn, on);
    sprayRow?.classList.toggle('hidden', !on);
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

function setActive(btn: HTMLElement | null | undefined, on: boolean): void {
  if (!btn) return;
  btn.classList.toggle('bg-emerald-600', on);
  btn.classList.toggle('text-white', on);
  btn.classList.toggle('border-emerald-400', on);
}

async function toggle(): Promise<void> {
  if (active) await doDeactivate();
  else await doActivate();
}

async function doActivate(): Promise<void> {
  if (!onActivate) return;
  await onActivate();
  syncActiveState();
  if (active) { voxelPaint.setColor(currentColor); voxelPaint.setTool('paint'); refreshControls(); }
}

async function doDeactivate(): Promise<void> {
  if (!onDeactivate) return;
  await onDeactivate();
  syncActiveState();
}

// ── panel construction ──────────────────────────────────────────────────────

function createPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'voxel-paint-panel';
  p.className = 'hidden absolute top-12 left-3 z-20 p-2 rounded-lg bg-zinc-900/95 backdrop-blur border border-zinc-700 shadow-xl text-xs text-zinc-200 flex flex-col gap-2 max-h-[80vh] overflow-y-auto';
  p.style.minWidth = '210px';

  const title = document.createElement('div');
  title.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  title.textContent = 'Voxel Studio';
  p.appendChild(title);

  p.appendChild(buildToolRow());
  p.appendChild(buildColorRow());
  brushSection = buildBrushSection();
  p.appendChild(brushSection);
  levelSection = buildLevelSection();
  p.appendChild(levelSection);
  p.appendChild(buildHistoryRow());
  p.appendChild(buildActions());
  return p;
}

function buildToolRow(): HTMLElement {
  toolBtns = {};
  const tools = document.createElement('div');
  tools.className = 'grid grid-cols-4 gap-1';
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
  return tools;
}

function buildColorRow(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-1';
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-5 gap-1';
  let activeSwatch: HTMLButtonElement | null = null;
  const selectColor = (hex: string, sw: HTMLButtonElement | null) => {
    currentColor = hex;
    voxelPaint.setColor(hex);
    if (activeSwatch) activeSwatch.classList.remove('ring-2', 'ring-white');
    if (sw) { sw.classList.add('ring-2', 'ring-white'); activeSwatch = sw; }
    // Choosing a color implies "draw" — leave a delete tool for a paint tool.
    if (voxelPaint.getTool() === 'remove' || voxelPaint.getTool() === 'boxRemove') voxelPaint.setTool('paint');
    refreshControls();
  };
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'w-6 h-6 rounded border border-zinc-600/60 hover:border-zinc-300 transition-colors';
    sw.style.backgroundColor = hex;
    sw.title = hex;
    sw.addEventListener('click', () => selectColor(hex, sw));
    grid.appendChild(sw);
    if (hex === currentColor) { sw.classList.add('ring-2', 'ring-white'); activeSwatch = sw; }
  }
  wrap.appendChild(grid);

  const customRow = document.createElement('label');
  customRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = '#ffaa00';
  customInput.className = 'w-6 h-6 rounded border border-zinc-600/60 bg-transparent cursor-pointer';
  customInput.title = 'Custom color';
  customInput.addEventListener('input', () => selectColor(customInput.value, null));
  customRow.appendChild(customInput);
  const customLabel = document.createElement('span');
  customLabel.textContent = 'Custom color';
  customRow.appendChild(customLabel);
  wrap.appendChild(customRow);
  return wrap;
}

function buildBrushSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('span');
  h.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  h.textContent = 'Brush';
  head.appendChild(h);
  sizeLabel = document.createElement('span');
  sizeLabel.className = 'text-[11px] text-zinc-400';
  head.appendChild(sizeLabel);
  sec.appendChild(head);

  // Size slider (0 = single voxel … 8 = wide).
  sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '0';
  sizeSlider.max = '8';
  sizeSlider.step = '1';
  sizeSlider.value = '0';
  sizeSlider.className = 'w-full accent-emerald-500';
  sizeSlider.title = 'Brush radius in voxels (0 = a single voxel)';
  sizeSlider.addEventListener('input', () => { voxelPaint.setBrushRadius(Number(sizeSlider!.value)); refreshControls(); });
  sec.appendChild(sizeSlider);

  // Shape buttons.
  shapeBtns = {};
  const shapes = document.createElement('div');
  shapes.className = 'grid grid-cols-3 gap-1';
  for (const s of BRUSH_SHAPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-1 py-1 rounded text-sm border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
    btn.textContent = s.label;
    btn.title = s.title;
    btn.addEventListener('click', () => { voxelPaint.setBrushShape(s.shape); refreshControls(); });
    shapes.appendChild(btn);
    shapeBtns[s.shape] = btn;
  }
  sec.appendChild(shapes);

  // Spray toggle + density.
  sprayBtn = document.createElement('button');
  sprayBtn.type = 'button';
  sprayBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
  sprayBtn.textContent = '○ Spray: off';
  sprayBtn.title = 'Scatter — affect only a random subset of the brush footprint for a speckled look';
  sprayBtn.addEventListener('click', () => { voxelPaint.setSpray(!voxelPaint.isSpray()); refreshControls(); });
  sec.appendChild(sprayBtn);

  sprayRow = document.createElement('label');
  sprayRow.className = 'hidden flex items-center gap-2 text-[11px] text-zinc-400';
  const densityLabel = document.createElement('span');
  densityLabel.textContent = 'Density';
  sprayRow.appendChild(densityLabel);
  const density = document.createElement('input');
  density.type = 'range';
  density.min = '5';
  density.max = '100';
  density.step = '5';
  density.value = String(Math.round(voxelPaint.getSprayDensity() * 100));
  density.className = 'flex-1 accent-emerald-500';
  density.addEventListener('input', () => voxelPaint.setSprayDensity(Number(density.value) / 100));
  sprayRow.appendChild(density);
  sec.appendChild(sprayRow);

  return sec;
}

function buildLevelSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'hidden flex flex-col gap-1 pt-1 border-t border-zinc-700/60';
  const h = document.createElement('span');
  h.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  h.textContent = 'Level axis';
  sec.appendChild(h);
  axisBtns = {};
  const row = document.createElement('div');
  row.className = 'grid grid-cols-3 gap-1';
  for (const a of AXES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-1 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
    btn.textContent = a.label;
    btn.title = `Recolor the clicked voxel's ${a.label} layer`;
    btn.addEventListener('click', () => { voxelPaint.setLevelAxis(a.axis); refreshControls(); });
    row.appendChild(btn);
    axisBtns[a.axis] = btn;
  }
  sec.appendChild(row);
  return sec;
}

function buildHistoryRow(): HTMLElement {
  const histRow = document.createElement('div');
  histRow.className = 'flex items-center gap-1 pt-1 border-t border-zinc-700/60';
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
  return histRow;
}

function buildActions(): HTMLElement {
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
  return actions;
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
