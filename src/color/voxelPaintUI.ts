// Voxel Studio UI — a self-contained overlay button + floating panel that only
// appears in voxel-language sessions. It mirrors the main Paint menu's layout
// (tool row → color → conditional brush section → conditional level/axis →
// history → actions) but operates on the voxel grid: pick a tool, drag faces to
// add/remove/recolor cubes, then "bake" commits the edited grid back to code.

import * as voxelPaint from './voxelPaint';
import type { VoxelTool, BrushShape } from './voxelPaint';
import { viewportToolsMount } from '../ui/popoverMenu';
import { attachViewportPanelDrag, setInitialPanelPosition } from '../ui/viewportPanelDrag';
import { createToolPanelHeader, TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from '../ui/toolPanel';
import { openViewportPanel, closeViewportPanel } from '../ui/viewportPanelRegistry';
import { createColorSwatch } from '../ui/colorPickerModal';
import { createSliderEntry, type SliderEntry } from '../ui/sliderEntry';
import { registerTool, setToolNote, notifyToolApplied, parsePrefillColor, type PrefillSchema, type ToolOpenContext, type ToolOpenResult } from '../ui/toolRegistry';

const SWATCHES: string[] = [
  '#ff3b30', '#ff8c42', '#ffd60a', '#34c759', '#5ac8fa',
  '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#1c1c1e',
];

// Tool buttons, in panel order. `label` is the glyph shown; `title` the tooltip.
const TOOLS: { tool: VoxelTool; label: string; title: string }[] = [
  { tool: 'view',      label: '👁', title: 'View — orbit the rounded result without editing (editing tools show blocks)' },
  { tool: 'paint',     label: '🖌', title: 'Brush — drag to recolor voxels (use Size for a wider brush)' },
  { tool: 'add',       label: '➕', title: 'Add — build a block onto the clicked face (set its X/Y/Z size and how deep it sinks in)' },
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
let onUpdateCode: (() => Promise<void> | void) | null = null;
let onSaveRaw: (() => Promise<void> | void) | null = null;
let active = false;
let currentColor = SWATCHES[0];
// Panel body (AI note banner host) + the swatch-ring sync a prefill colour uses.
let contentEl: HTMLElement | null = null;
let syncColorRing: ((hex: string) => void) | null = null;

// One-of-N viewport panel: opening Paint/Annotate/etc. closes the studio.
const registryEntry = { close(): void { if (active) void doDeactivate(); } };

// Esc closes the studio (discarding edits) — but defer to any open dialog,
// matching the paint menu's Escape behavior.
function onStudioEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  if (active) void doDeactivate();
}

// Live element refs so refreshControls can reflect engine state in the panel.
let toolBtns: Partial<Record<VoxelTool, HTMLButtonElement>> = {};
let shapeBtns: Partial<Record<BrushShape, HTMLButtonElement>> = {};
let axisBtns: Partial<Record<number, HTMLButtonElement>> = {};
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let statusEl: HTMLElement | null = null;
let brushSection: HTMLElement | null = null;
let blockSection: HTMLElement | null = null;
let depthSection: HTMLElement | null = null;
let levelSection: HTMLElement | null = null;
let sizeEntry: SliderEntry | null = null;
let sizeLabel: HTMLElement | null = null;
let sprayBtn: HTMLButtonElement | null = null;
let sprayRow: HTMLElement | null = null;
const blockEntries: Partial<Record<0 | 1 | 2, SliderEntry>> = {};
let blockSizeLabel: HTMLElement | null = null;
let depthEntry: SliderEntry | null = null;
let depthLabel: HTMLElement | null = null;
let roundSlider: HTMLInputElement | null = null;
let roundValueLabel: HTMLElement | null = null;
let flatBottomBtn: HTMLButtonElement | null = null;
let baseLayersInput: HTMLInputElement | null = null;
let roundModeBtns: Partial<Record<'off' | 'surfaceNets' | 'taubin', HTMLButtonElement>> = {};
let strengthRow: HTMLElement | null = null;
let flatRow: HTMLElement | null = null;
let editWarningEl: HTMLElement | null = null;
// The Rounding algorithm the panel currently drives. Surface Nets has no usable
// amount knob (it's inherently smooth at any strength), so its slider is hidden;
// Taubin relaxes the blocky mesh by `strength`, giving a true 0→max dial.
let roundMode: 'off' | 'surfaceNets' | 'taubin' = 'off';
let flatBottomState = false;

export interface VoxelPaintUICallbacks {
  /** Called when the user clicks the toggle button to enter the studio. The
   *  main app is responsible for calling `voxelPaint.activate(...)` (so the
   *  callback can stitch in the editor lock + mesh updater). */
  activate: () => Promise<void> | void;
  /** Called to cancel editing without committing. */
  deactivate: () => Promise<void> | void;
  /** Called to append the edits to the existing code as v.set/v.remove ops. */
  updateCode: () => Promise<void> | void;
  /** Called to replace the code with voxels.decode(...) of the full grid. */
  saveRaw: () => Promise<void> | void;
}

/** Mount the Voxel Studio button into the viewport's controls container. */
export function initVoxelPaintUI(controlsContainer: HTMLElement, callbacks: VoxelPaintUICallbacks): void {
  onActivate = callbacks.activate;
  onDeactivate = callbacks.deactivate;
  onUpdateCode = callbacks.updateCode;
  onSaveRaw = callbacks.saveRaw;

  paintBtn = document.createElement('button');
  paintBtn.id = 'voxel-paint-toggle';
  paintBtn.className = `hidden ${TOOL_TOGGLE_IDLE}`;
  paintBtn.textContent = '🧊 Voxel Studio';
  paintBtn.title = 'Add, remove, brush, and recolor voxels — then bake to code.';
  paintBtn.addEventListener('click', toggle);

  // Slot next to the existing paint button so the two read as related. Anchor
  // within whichever container holds the paint button (the Tools popover).
  const toolsMount = viewportToolsMount(controlsContainer);
  const sibling = toolsMount.querySelector('#paint-toggle');
  if (sibling) toolsMount.insertBefore(paintBtn, sibling);
  else toolsMount.appendChild(paintBtn);

  panel = createPanel();
  // Anchor to the positioned viewport pane (the toolbar's parent), not the
  // small top-right toolbar box — so the panel's `max-h-[calc(100%-…)]` and the
  // mobile bottom-sheet layout measure against the full viewport (matches the
  // Paint panel).
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(panel);

  registerTool({
    id: 'tool-voxel-paint',
    title: 'Voxel Studio (edit voxels)',
    hint: 'Tools',
    prefillSchema: VOXEL_PREFILL_SCHEMA,
    open: (prefill, ctx) => openVoxelStudioWithPrefill(prefill, ctx),
    getState: () => (active ? getVoxelStudioState() : null),
    isOpen: () => active,
    close: () => { if (active) void doDeactivate(); },
  });
}

const AXIS_NAMES = ['x', 'y', 'z'] as const;

/** Prefill keys for `openTool('tool-voxel-paint', …)` — tool, colour and brush
 *  settings; nothing is edited until the user clicks the model. */
const VOXEL_PREFILL_SCHEMA: PrefillSchema = {
  tool: { type: 'enum', values: TOOLS.map(t => t.tool), description: 'Active studio tool.' },
  color: { type: 'color', description: 'Voxel colour ([r,g,b] 0..1 or "#rrggbb").' },
  brush: { type: 'object', description: 'Brush (as setVoxelBrush).', fields: {
    radius: { type: 'number', integer: true, min: 0, max: voxelPaint.MAX_BRUSH_RADIUS, description: 'Brush radius in voxels (0 = one voxel).' },
    shape: { type: 'enum', values: BRUSH_SHAPES.map(s => s.shape) },
    spray: { type: 'boolean' },
    sprayDensity: { type: 'number', min: 0.05, max: 1 },
    block: { type: 'vec3', description: 'Add-tool block size [x,y,z] in voxels (1..32 each).' },
    depth: { type: 'number', integer: true, min: 0, description: 'How deep an added block sinks into the face.' },
  } },
  levelAxis: { type: 'enum', values: AXIS_NAMES, description: 'Axis the level tool recolours.' },
};

function getVoxelStudioState(): Record<string, unknown> {
  return {
    tool: voxelPaint.getTool(),
    color: currentColor,
    brush: {
      radius: voxelPaint.getBrushRadius(), shape: voxelPaint.getBrushShape(), spray: voxelPaint.isSpray(),
      sprayDensity: voxelPaint.getSprayDensity(), block: voxelPaint.getBlockSize(), depth: voxelPaint.getAddDepth(),
    },
    levelAxis: AXIS_NAMES[voxelPaint.getLevelAxis()],
  };
}

const toHex = (c: [number, number, number]) => `#${c.map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('')}`;

async function openVoxelStudioWithPrefill(p: Record<string, unknown> | undefined, ctx: ToolOpenContext): Promise<ToolOpenResult> {
  const pre = p ?? {};
  const brush = (pre.brush ?? {}) as Record<string, unknown>;
  const block = brush.block as [number, number, number] | undefined;
  if (block && block.some(n => !Number.isInteger(n) || n < 1 || n > voxelPaint.MAX_BLOCK_SIZE)) {
    return { error: `brush.block values must be integers 1..${voxelPaint.MAX_BLOCK_SIZE}` };
  }
  if (!active) await doActivate();
  if (!active) return { error: 'Voxel Studio could not start (needs a voxel model on screen).' };
  setToolNote(contentEl, ctx.note, ctx.source);
  if (pre.tool !== undefined) voxelPaint.setTool(pre.tool as VoxelTool);
  if (pre.color !== undefined) {
    const c = parsePrefillColor(pre.color);
    if (c) { currentColor = toHex(c); voxelPaint.setColor(currentColor); syncColorRing?.(currentColor); }
  }
  if (brush.radius !== undefined) voxelPaint.setBrushRadius(brush.radius as number);
  if (brush.shape !== undefined) voxelPaint.setBrushShape(brush.shape as BrushShape);
  if (brush.spray !== undefined) voxelPaint.setSpray(brush.spray as boolean);
  if (brush.sprayDensity !== undefined) voxelPaint.setSprayDensity(brush.sprayDensity as number);
  if (block) ([0, 1, 2] as const).forEach(a => voxelPaint.setBlockSize(a, block[a]));
  if (brush.depth !== undefined) voxelPaint.setAddDepth(brush.depth as number);
  if (pre.levelAxis !== undefined) voxelPaint.setLevelAxis(AXIS_NAMES.indexOf(pre.levelAxis as 'x' | 'y' | 'z') as 0 | 1 | 2);
  refreshControls();
  return { applied: pre, ignored: [] };
}

/** Toggle button visibility based on whether the active language is voxel. */
export function setVoxelPaintAvailable(available: boolean): void {
  if (!paintBtn) return;
  paintBtn.classList.toggle('hidden', !available);
  if (!available && active) void doDeactivate();
}

/** Reflect the engine's active state on the toggle button + panel. Runs on
 *  every state change, so the enter/exit side-effects (positioning, the
 *  one-panel registry, the Esc listener) are guarded by a transition check —
 *  that way they fire once whether the studio was opened from the button or
 *  programmatically (activateVoxelPaint), and never re-position mid-drag. */
export function syncActiveState(): void {
  const nowActive = voxelPaint.isActive();
  const entered = nowActive && !active;
  const exited = !nowActive && active;
  active = nowActive;
  if (!paintBtn || !panel) return;
  // Reassigning className wipes the availability-driven `hidden` class, so
  // preserve it across the swap to the shared idle/active toggle styling.
  const wasHidden = paintBtn.classList.contains('hidden');
  if (active) {
    paintBtn.className = TOOL_TOGGLE_ACTIVE;
    panel.classList.remove('hidden');
  } else {
    paintBtn.className = TOOL_TOGGLE_IDLE;
    panel.classList.add('hidden');
  }
  paintBtn.classList.toggle('hidden', wasHidden);
  if (entered) {
    setInitialPanelPosition(panel);          // place it below the toolbar
    openViewportPanel(registryEntry);        // close any other viewport panel
    document.addEventListener('keydown', onStudioEscape);
    voxelPaint.setColor(currentColor);
    voxelPaint.setTool('view');
  } else if (exited) {
    setToolNote(contentEl, null);
    document.removeEventListener('keydown', onStudioEscape);
    closeViewportPanel(registryEntry);
  }
  refreshControls();
}

/** Refresh tool/shape/axis highlight, conditional sections, brush readout,
 *  undo/redo enablement, and the status line. */
function refreshControls(): void {
  const tool = voxelPaint.getTool();
  for (const t of TOOLS) setActive(toolBtns[t.tool], t.tool === tool);

  // Brush (radius/shape/spray) shows for paint/remove; the add tool gets the
  // block (X/Y/Z) size controls; depth shows for add + the box tools; level
  // gets the axis picker.
  const isBox = tool === 'boxAdd' || tool === 'boxRemove';
  brushSection?.classList.toggle('hidden', !(tool === 'paint' || tool === 'remove'));
  blockSection?.classList.toggle('hidden', tool !== 'add');
  depthSection?.classList.toggle('hidden', !(tool === 'add' || isBox));
  levelSection?.classList.toggle('hidden', tool !== 'level');

  // The "rounding is hidden while editing" banner shows only when an edit tool
  // is active AND the grid is actually rounded (so it'd otherwise be visible).
  const surfSmooth = voxelPaint.getSurfacing()?.mode === 'smooth';
  editWarningEl?.classList.toggle('hidden', !(voxelPaint.isEditTool(tool) && surfSmooth));

  for (const s of BRUSH_SHAPES) setActive(shapeBtns[s.shape], s.shape === voxelPaint.getBrushShape());
  for (const a of AXES) setActive(axisBtns[a.axis], a.axis === voxelPaint.getLevelAxis());

  syncEntry(sizeEntry, voxelPaint.getBrushRadius());
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

  // Add-block controls.
  const size = voxelPaint.getBlockSize();
  for (const axis of [0, 1, 2] as const) {
    syncEntry(blockEntries[axis], size[axis]);
  }
  if (blockSizeLabel) blockSizeLabel.textContent = `${size[0]}×${size[1]}×${size[2]}`;
  syncEntry(depthEntry, voxelPaint.getAddDepth());
  if (depthLabel) {
    const d = voxelPaint.getAddDepth();
    if (d === 0) depthLabel.textContent = isBox ? 'flat' : 'on surface';
    else depthLabel.textContent = isBox ? `+${d} layers` : `${d} deep`;
  }

  // Rounding section reflects the grid's current surfacing.
  const surf = voxelPaint.getSurfacing();
  const smooth = surf?.mode === 'smooth';
  flatBottomState = smooth && !!surf?.flatBottom;
  roundMode = !smooth ? 'off' : ((surf?.algorithm ?? 'surfaceNets') === 'taubin' ? 'taubin' : 'surfaceNets');
  setActive(roundModeBtns.off, roundMode === 'off');
  setActive(roundModeBtns.surfaceNets, roundMode === 'surfaceNets');
  setActive(roundModeBtns.taubin, roundMode === 'taubin');
  strengthRow?.classList.toggle('hidden', roundMode !== 'taubin');
  flatRow?.classList.toggle('hidden', roundMode === 'off');
  if (roundMode === 'taubin' && roundSlider && document.activeElement !== roundSlider) {
    roundSlider.value = String(Math.round((surf?.strength ?? 1) * 100));
  }
  const amt = Number(roundSlider?.value ?? '50');
  if (roundValueLabel) {
    roundValueLabel.textContent = roundMode === 'off' ? 'Off (blocky)' : roundMode === 'surfaceNets' ? 'Surface Nets' : `Taubin ${amt}%`;
  }
  if (flatBottomBtn) setActive(flatBottomBtn, flatBottomState);
  if (baseLayersInput && document.activeElement !== baseLayersInput) {
    baseLayersInput.value = String(smooth ? (surf?.baseLayers ?? 0) : 0);
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
  btn.classList.toggle('bg-blue-600', on);
  btn.classList.toggle('text-white', on);
  btn.classList.toggle('border-blue-400', on);
}

async function toggle(): Promise<void> {
  if (active) await doDeactivate();
  else await doActivate();
}

async function doActivate(): Promise<void> {
  if (!onActivate) return;
  await onActivate();
  // syncActiveState (called by the activate callback + here) handles the
  // enter side-effects: positioning, the one-panel registry, Esc, seeding.
  syncActiveState();
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
  // Match the Paint panel's shell: draggable header + scrollable body, clamped
  // to the viewport, single rounded card.
  p.className = 'hidden z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl absolute rounded-lg w-56 max-h-[calc(100%-3.5rem)] text-xs text-zinc-200';

  // Header: drag handle + title + × close (shared tool-panel chrome).
  const header = createToolPanelHeader('🧊 Voxel Studio', () => { void doDeactivate(); }, 'Close Voxel Studio');
  p.appendChild(header);
  attachViewportPanelDrag(header, p);

  // Scrollable content.
  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-2';
  contentEl = content;
  content.appendChild(buildToolRow());
  editWarningEl = document.createElement('p');
  editWarningEl.className = 'hidden text-[10px] leading-tight rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 px-2 py-1';
  editWarningEl.textContent = '⚠ Rounding is hidden while editing. Switch to 👁 View to see the rounded result.';
  content.appendChild(editWarningEl);
  content.appendChild(buildColorRow());
  brushSection = buildBrushSection();
  content.appendChild(brushSection);
  blockSection = buildBlockSection();
  content.appendChild(blockSection);
  depthSection = buildDepthSection();
  content.appendChild(depthSection);
  levelSection = buildLevelSection();
  content.appendChild(levelSection);
  content.appendChild(buildRoundingSection());
  content.appendChild(buildHistoryRow());
  content.appendChild(buildActions());
  p.appendChild(content);
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
  const swatchBtns = new Map<string, HTMLButtonElement>();
  syncColorRing = (hex) => {
    if (activeSwatch) activeSwatch.classList.remove('ring-2', 'ring-white');
    activeSwatch = swatchBtns.get(hex.toLowerCase()) ?? null;
    activeSwatch?.classList.add('ring-2', 'ring-white');
  };
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    swatchBtns.set(hex.toLowerCase(), sw);
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
  const custom = createColorSwatch({
    initialHex: '#ffaa00',
    title: 'Custom color',
    modalTitle: 'Custom voxel colour',
    className: 'w-6 h-6 shrink-0 rounded border border-zinc-600/60 cursor-pointer hover:border-white/70 transition-colors',
    onPick: (hex) => selectColor(hex, null),
  });
  const customInput = custom.el;
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

  // Size slider (0 = single voxel … 8 = wide); the box accepts up to the
  // engine cap.
  sizeEntry = voxelEntry(0, 8, voxelPaint.MAX_BRUSH_RADIUS, voxelPaint.getBrushRadius(),
    v => voxelPaint.setBrushRadius(v));
  sizeEntry.range.title = 'Brush radius in voxels (0 = a single voxel)';
  sizeEntry.input.title = `Brush radius in voxels. Type up to ${voxelPaint.MAX_BRUSH_RADIUS} to go past the slider.`;
  const sizeRow = document.createElement('div');
  sizeRow.className = 'flex items-center gap-2';
  sizeRow.append(sizeEntry.range, sizeEntry.input);
  sec.appendChild(sizeRow);

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
  density.className = 'flex-1 accent-blue-500';
  density.addEventListener('input', () => voxelPaint.setSprayDensity(Number(density.value) / 100));
  sprayRow.appendChild(density);
  sec.appendChild(sprayRow);

  return sec;
}

function buildBlockSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'hidden flex flex-col gap-1.5 pt-1 border-t border-zinc-700/60';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('span');
  h.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  h.textContent = 'Block size';
  head.appendChild(h);
  blockSizeLabel = document.createElement('span');
  blockSizeLabel.className = 'text-[11px] text-zinc-400';
  head.appendChild(blockSizeLabel);
  sec.appendChild(head);

  // One X/Y/Z slider per axis (1…16). The block is centered on the clicked
  // voxel across the face and grows outward along the normal.
  const AXIS_META: { axis: 0 | 1 | 2; label: string }[] = [
    { axis: 0, label: 'X' }, { axis: 1, label: 'Y' }, { axis: 2, label: 'Z' },
  ];
  for (const { axis, label } of AXIS_META) {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-2 text-[11px] text-zinc-400';
    const tag = document.createElement('span');
    tag.className = 'w-3 text-zinc-300';
    tag.textContent = label;
    row.appendChild(tag);
    // The slider covers 1–16, the box accepts up to the engine cap.
    const entry = voxelEntry(1, 16, voxelPaint.MAX_BLOCK_SIZE, voxelPaint.getBlockSize()[axis],
      v => voxelPaint.setBlockSize(axis, v));
    entry.range.title = `Block ${label} size in voxels`;
    entry.input.title = `Block ${label} size in voxels. Type up to ${voxelPaint.MAX_BLOCK_SIZE} to go past the slider.`;
    row.append(entry.range, entry.input);
    blockEntries[axis] = entry;
    sec.appendChild(row);
  }

  return sec;
}

/** Re-sync a control from paint state. refreshControls also runs on background
 *  state changes (remesh, undo, API calls), so a box the user is typing in is
 *  left alone until they commit. */
function syncEntry(entry: SliderEntry | null | undefined, v: number): void {
  if (entry && document.activeElement !== entry.input) entry.set(v);
}

/** Whole-number slider + typed box for a voxel count: the slider covers
 *  [min, sliderMax], the box accepts up to `hardMax`. Each edit applies the
 *  value to the paint state, then re-syncs every control from that state. */
function voxelEntry(min: number, sliderMax: number, hardMax: number, value: number, apply: (v: number) => void): SliderEntry {
  return createSliderEntry({
    min, max: sliderMax, step: 1, value, hardMax, integer: true,
    onChange: v => { apply(v); refreshControls(); },
    inputClass: 'w-12 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums',
  });
}

// Depth control, shared by the add tool (how far the block sinks into the
// surface) and the box tools (how many extra layers the fill/subtract extrudes
// along the clicked face). 0 = flush to the surface in both cases.
function buildDepthSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'hidden flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const dh = document.createElement('span');
  dh.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  dh.textContent = 'Depth';
  head.appendChild(dh);
  depthLabel = document.createElement('span');
  depthLabel.className = 'text-[11px] text-zinc-400';
  head.appendChild(depthLabel);
  sec.appendChild(head);

  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';

  // Typed value: the slider tops out at 16, but the box has no max so you can
  // sink a block deeper than the slider reaches.
  depthEntry = voxelEntry(0, 16, Infinity, voxelPaint.getAddDepth(), v => voxelPaint.setAddDepth(v));
  depthEntry.range.title = 'Add: layers the block sinks into the surface. Box: extra layers the fill grows / subtract carves (0 = flush to the clicked face).';
  depthEntry.input.title = 'Depth in layers. Type a value past the slider’s 16 to go deeper.';
  depthEntry.input.classList.replace('w-12', 'w-14');
  row.append(depthEntry.range, depthEntry.input);

  sec.appendChild(row);

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

/** Rounding (surfacing) controls: an algorithm toggle (Off = hard blocks /
 *  Surface Nets / Taubin) plus a strength slider (Taubin only — Surface Nets has
 *  no usable amount knob) and "keep flat" pins. The result previews live in the
 *  viewport; editing on the canvas snaps back to blocks. Applied to the grid's
 *  surfacing and baked into the saved model. */
function buildRoundingSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('span');
  h.className = 'text-[10px] uppercase tracking-wider text-zinc-500';
  h.textContent = 'Rounding';
  head.appendChild(h);
  roundValueLabel = document.createElement('span');
  roundValueLabel.className = 'text-[11px] text-zinc-400';
  head.appendChild(roundValueLabel);
  sec.appendChild(head);

  // Algorithm toggle: Off / Surface Nets / Taubin.
  const modeRow = document.createElement('div');
  modeRow.className = 'grid grid-cols-3 gap-1';
  const MODES: { mode: 'off' | 'surfaceNets' | 'taubin'; label: string; title: string }[] = [
    { mode: 'off', label: 'Off', title: 'Hard blocks — no rounding' },
    { mode: 'surfaceNets', label: 'Surface Nets', title: 'Re-mesh to a fully smooth surface (no amount — inherently smooth)' },
    { mode: 'taubin', label: 'Taubin', title: 'Round the blocky mesh by an adjustable amount (0 → max)' },
  ];
  roundModeBtns = {};
  for (const m of MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-1 py-1 rounded text-[11px] border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
    btn.textContent = m.label;
    btn.title = m.title;
    btn.addEventListener('click', () => { roundMode = m.mode; applyRounding(); });
    modeRow.appendChild(btn);
    roundModeBtns[m.mode] = btn;
  }
  sec.appendChild(modeRow);

  // Strength slider (Taubin only).
  strengthRow = document.createElement('div');
  roundSlider = document.createElement('input');
  roundSlider.type = 'range';
  roundSlider.min = '5'; roundSlider.max = '100'; roundSlider.step = '5'; roundSlider.value = '50';
  roundSlider.className = 'w-full accent-blue-500';
  roundSlider.title = 'Rounding amount (Taubin): 5% = barely rounded, 100% = fully rounded';
  roundSlider.addEventListener('input', applyRounding);
  strengthRow.appendChild(roundSlider);
  sec.appendChild(strengthRow);

  flatRow = document.createElement('div');
  flatRow.className = 'flex items-center gap-2';
  flatBottomBtn = document.createElement('button');
  flatBottomBtn.type = 'button';
  flatBottomBtn.className = 'flex-1 px-1 py-1 rounded text-[11px] border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
  flatBottomBtn.textContent = 'Flat bottom';
  flatBottomBtn.title = 'Keep the build-plate face flat while edges round';
  flatBottomBtn.addEventListener('click', () => { flatBottomState = !flatBottomState; applyRounding(); });
  flatRow.appendChild(flatBottomBtn);

  const baseWrap = document.createElement('label');
  baseWrap.className = 'flex items-center gap-1 text-[11px] text-zinc-400';
  const baseSpan = document.createElement('span');
  baseSpan.textContent = 'Flat base';
  baseWrap.appendChild(baseSpan);
  baseLayersInput = document.createElement('input');
  baseLayersInput.type = 'number';
  baseLayersInput.min = '0'; baseLayersInput.max = '64'; baseLayersInput.value = '0';
  baseLayersInput.className = 'w-12 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  baseLayersInput.title = 'Keep the bottom N voxel layers fully blocky (0 = none)';
  baseLayersInput.addEventListener('input', applyRounding);
  baseWrap.appendChild(baseLayersInput);
  const baseUnit = document.createElement('span');
  baseUnit.textContent = 'layers';
  baseWrap.appendChild(baseUnit);
  flatRow.appendChild(baseWrap);
  sec.appendChild(flatRow);

  const hint = document.createElement('p');
  hint.className = 'text-[10px] text-zinc-500 leading-tight';
  hint.textContent = 'Shown in 👁 View; editing tools render blocks until you switch back.';
  sec.appendChild(hint);
  return sec;
}

/** Read the rounding controls and push the resulting surfacing to the grid. */
function applyRounding(): void {
  if (roundMode === 'off') { voxelPaint.setRounding(null); refreshControls(); return; }
  const base = Math.max(0, Math.floor(Number(baseLayersInput?.value ?? '0')));
  const common = { flatBottom: flatBottomState || undefined, baseLayers: base > 0 ? base : undefined };
  if (roundMode === 'surfaceNets') {
    voxelPaint.setRounding({ algorithm: 'surfaceNets', ...common });
  } else {
    const amount = Number(roundSlider?.value ?? '50');
    voxelPaint.setRounding({ algorithm: 'taubin', strength: Math.max(0.05, amount / 100), ...common });
  }
  refreshControls();
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
  actions.className = 'flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  // Primary: keep the procedural code, append the edits as readable ops.
  const updateBtn = document.createElement('button');
  updateBtn.type = 'button';
  updateBtn.className = 'w-full px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors';
  updateBtn.textContent = 'Update code';
  updateBtn.title = 'Keep your code and append these edits as v.set/v.remove statements, then save a version';
  updateBtn.addEventListener('click', async () => { notifyToolApplied('tool-voxel-paint', 'Update code'); if (onUpdateCode) await onUpdateCode(); syncActiveState(); });
  actions.appendChild(updateBtn);

  // Secondary: replace the editor with the raw decoded grid (confirms first).
  const saveRawBtn = document.createElement('button');
  saveRawBtn.type = 'button';
  saveRawBtn.className = 'w-full px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors';
  saveRawBtn.textContent = 'Save as raw voxel data';
  saveRawBtn.title = 'Replace the code with voxels.decode(...) of the whole grid (warns before overwriting)';
  saveRawBtn.addEventListener('click', async () => { notifyToolApplied('tool-voxel-paint', 'Save as raw voxel data'); if (onSaveRaw) await onSaveRaw(); syncActiveState(); });
  actions.appendChild(saveRawBtn);

  return actions;
}
