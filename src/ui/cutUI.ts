// Cut tool UI — viewport-overlay "✂ Cut" button + floating panel.
// Follows the simplifyUI.ts pattern: button in clipControls, panel appended to
// the same container, open/close, forceDeactivate(), and CutHandlers injected
// from main.ts.
//
// The panel lets the user:
//   1. Choose a cut shape (plane/box/sphere/cylinder) and gizmo mode (T/R/S keys).
//   2. Choose which side to keep (outside/inside).
//   3. Position the cutter via XYZ inputs or snap to 25/50/75% along an axis.
//   4. Optionally preserve triangle colors after the cut.
//   5. Apply the cut (runs in the geometry Worker via cutInWorker).
//   6. Save the result as a new session version.

import {
  activate as activateGizmo,
  deactivate as deactivateGizmo,
  setCutShape,
  setCutMode,
  setKeepSide,
  getParams,
  getCutShape,
  getCutMode,
  getKeepSide,
  onGizmoChange,
  getProxyPosition,
  setProxyPosition,
  setGizmoHandlesVisible,
  snapToFaceNormal,
  type CutShape,
  type CutMode,
  type KeepSide,
  type CutGizmoParams,
} from '../cut/cutGizmo';
import { pickModelFace } from '../renderer/viewport';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { registerExclusiveMode, deactivateMode } from './modeExclusion';
import type { MeshData } from '../geometry/types';
import { showToast } from './toast';
import { meshBounds } from '../color/slabPaint';

export type { CutGizmoParams };

/** How the cut result is saved: one part per component, or all merged into one. */
export type CutResultMode = 'separate' | 'combined';

export interface CutApplyResult {
  triangleCount: number;
  componentCount: number;
}

export interface CutSaveResult {
  ok: boolean;
  message: string;
}

export interface CutHandlers {
  /** Snapshot current model as the cut baseline. Returns ok or a reason.
   *  When userInitiated, the implementation should close other overlay tools. */
  open(userInitiated: boolean): { ok: true } | { ok: false; reason: string };
  /** Return the current live mesh (for the gizmo). */
  getMesh(): MeshData | null;
  /** Execute the cut in the Worker and apply the result to the live viewport.
   *  Returns the result triangle count, or null if the shape doesn't intersect. */
  apply(
    params: CutGizmoParams,
    preserveColors: boolean,
  ): Promise<CutApplyResult | null>;
  /** Bake the cut result as a new session version. */
  save(resultMode: CutResultMode): Promise<CutSaveResult>;
}

// Button style constants
const BTN_INACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const BTN_ACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';

// Module-level state
let cutBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let handlers: CutHandlers | null = null;
let statusEl: HTMLElement | null = null;
let applyBtn: HTMLButtonElement | null = null;
let saveBtn: HTMLButtonElement | null = null;
let applying = false;

const registryEntry = { close(): void { if (isCutOpen()) closePanel(); } };

let preserveColors = true;
let showHandles = true;
let cutResultMode: CutResultMode = 'separate';

// XYZ position inputs — kept in module scope so the gizmo-change listener can update them
let posXInput: HTMLInputElement | null = null;
let posYInput: HTMLInputElement | null = null;
let posZInput: HTMLInputElement | null = null;
let updatingInputs = false; // prevents feedback loops when setting inputs programmatically

// Keyboard shortcut listener — added when panel opens, removed when it closes
let keydownListener: ((e: KeyboardEvent) => void) | null = null;

// Debounced auto-preview timer (module scope so closePanel can cancel it)
let autoPreviewTimer: ReturnType<typeof setTimeout> | null = null;

// Face-align mode: user clicks a model face to snap the cutter's orientation
let faceAlignMode = false;
let faceAlignClickHandler: ((e: MouseEvent) => void) | null = null;

function cancelFaceAlign(): void {
  if (!faceAlignMode) return;
  faceAlignMode = false;
  if (faceAlignClickHandler) {
    document.removeEventListener('click', faceAlignClickHandler, { capture: true } as AddEventListenerOptions);
    faceAlignClickHandler = null;
  }
  const canvas = document.querySelector('canvas');
  if (canvas) canvas.style.cursor = '';
}

/** Initialize the Cut UI — adds the toolbar button and builds the floating panel. */
export function initCutUI(controlsContainer: HTMLElement, h: CutHandlers): void {
  handlers = h;

  cutBtn = document.createElement('button');
  cutBtn.id = 'cut-toggle';
  cutBtn.className = BTN_INACTIVE;
  cutBtn.textContent = '✂ Cut';
  cutBtn.title = 'Cut the model with a plane or shape';
  cutBtn.addEventListener('click', toggle);

  // Insert before simplify button if present, otherwise at end.
  // Use parentNode because simplifyBtn may be nested inside a toolbar group (not a direct child).
  const simplifyBtn = controlsContainer.querySelector('#simplify-toggle');
  if (simplifyBtn?.parentNode) simplifyBtn.parentNode.insertBefore(cutBtn, simplifyBtn);
  else controlsContainer.appendChild(cutBtn);

  panel = buildPanel();
  controlsContainer.appendChild(panel);
  registerExclusiveMode('cut', () => { if (isCutOpen()) closePanel(); });
}

export function isCutOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

/** Close the panel without affecting geometry. Called when other tools open. */
export function forceDeactivate(): void {
  if (!isCutOpen()) return;
  closePanel();
}

function toggle(): void {
  if (isCutOpen()) closePanel();
  else openPanel();
}

function openPanel(): void {
  if (!handlers || !panel) return;
  const res = handlers.open(true);
  if (!res.ok) {
    showToast(res.reason, { variant: 'warn' });
    return;
  }
  deactivateMode('paint');
  deactivateMode('imagePaint');
  deactivateMode('pen');
  deactivateMode('text');
  deactivateMode('select');
  openViewportPanel(registryEntry);
  setInitialPanelPosition(panel);
  panel.classList.remove('hidden');
  if (cutBtn) cutBtn.className = BTN_ACTIVE;
  // Activate the 3-D gizmo.
  const mesh = handlers.getMesh();
  if (mesh) {
    activateGizmo(mesh);
    syncPositionInputs(); // sync XYZ inputs to gizmo's initial position
  }
  // Keyboard shortcuts: T = translate, R = rotate, S = scale, Escape = close
  keydownListener = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { closePanel(); return; }
    const tm = panel && (panel as HTMLElement & { _triggerMode?: (m: CutMode) => void })._triggerMode;
    if (!tm) return;
    if (k === 't') tm('translate');
    else if (k === 'r') tm('rotate');
    else if (k === 's') tm('scale');
  };
  document.addEventListener('keydown', keydownListener);
}

function closePanel(): void {
  cancelFaceAlign();
  if (autoPreviewTimer !== null) { clearTimeout(autoPreviewTimer); autoPreviewTimer = null; }
  panel?.classList.add('hidden');
  if (cutBtn) cutBtn.className = BTN_INACTIVE;
  deactivateGizmo();
  closeViewportPanel(registryEntry);
  if (keydownListener) {
    document.removeEventListener('keydown', keydownListener);
    keydownListener = null;
  }
}

// ── Panel builder ──────────────────────────────────────────────────────────────

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'cut-panel';
  // Fixed width, viewport-capped height. `vh` is always relative to the viewport
  // so calc(100vh-4rem) works correctly regardless of parent container size.
  p.className = [
    'hidden absolute top-10 right-0 z-20 flex flex-col',
    'bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl rounded-lg',
    'w-72 max-h-[min(560px,calc(100vh-4rem))]',
  ].join(' ');

  // ── Draggable header ─────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = [
    'shrink-0 flex items-center justify-between gap-2',
    'px-2.5 py-2 border-b border-zinc-700/70',
    'cursor-move select-none touch-none',
  ].join(' ');

  const headerTitle = document.createElement('div');
  headerTitle.className = 'text-[11px] text-zinc-300 font-medium';
  headerTitle.textContent = '✂ Cut';
  header.appendChild(headerTitle);

  const closeBtn = document.createElement('button');
  closeBtn.className = [
    'shrink-0 -mr-1 w-7 h-7 flex items-center justify-center rounded',
    'text-base leading-none text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors',
  ].join(' ');
  closeBtn.title = 'Close cut panel';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => closePanel());
  header.appendChild(closeBtn);
  p.appendChild(header);

  attachViewportPanelDrag(header, p);

  // ── Scrollable content ───────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-3';
  p.appendChild(content);

  // === Cut shape ===
  appendSectionLabel(content, 'Cut Shape');
  const shapeRow = document.createElement('div');
  shapeRow.className = 'grid grid-cols-2 gap-1 mt-1';
  const shapes: [CutShape, string, string][] = [
    ['plane',    '— Plane',    'Cut along an infinite plane'],
    ['box',      '▪ Box',      'Cut with a rectangular box'],
    ['sphere',   '● Sphere',   'Cut with a sphere'],
    ['cylinder', '⌀ Cylinder', 'Cut with a cylinder (Z-axis)'],
  ];
  const shapeButtons = new Map<CutShape, HTMLButtonElement>();
  for (const [shape, label, tooltip] of shapes) {
    const btn = buildToggleBtn(label, tooltip, shape === getCutShape());
    btn.addEventListener('click', () => {
      setCutShape(shape);
      for (const [s, b] of shapeButtons) b.className = toggleBtnClass(s === getCutShape());
      updateModeButtons();
    });
    shapeButtons.set(shape, btn);
    shapeRow.appendChild(btn);
  }
  content.appendChild(shapeRow);

  // === Gizmo mode ===
  const modeLabelRow = document.createElement('div');
  modeLabelRow.className = 'flex items-center justify-between mt-1';
  const modeLabel = document.createElement('div');
  modeLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  modeLabel.textContent = 'Gizmo Mode';
  modeLabelRow.appendChild(modeLabel);
  const modeHint = document.createElement('div');
  modeHint.className = 'text-[10px] text-zinc-600';
  modeHint.textContent = 'T · R · S';
  modeLabelRow.appendChild(modeHint);
  content.appendChild(modeLabelRow);

  const modeRow = document.createElement('div');
  modeRow.className = 'grid grid-cols-3 gap-1';
  const modes: [CutMode, string][] = [
    ['translate', 'Move'],
    ['rotate',    'Rotate'],
    ['scale',     'Scale'],
  ];
  const modeButtons = new Map<CutMode, HTMLButtonElement>();

  function updateModeButtons(): void {
    const shape = getCutShape();
    for (const [m, b] of modeButtons) {
      const disabled = shape === 'plane' && m === 'scale';
      b.disabled = disabled;
      b.className = modeBtnClass(m === getCutMode() && !disabled, disabled);
    }
  }

  function triggerMode(m: CutMode): void {
    setCutMode(m);
    updateModeButtons();
  }
  // Expose triggerMode so the keydown listener can call it
  (p as HTMLElement & { _triggerMode?: (m: CutMode) => void })._triggerMode = triggerMode;

  for (const [mode, label] of modes) {
    const btn = document.createElement('button');
    btn.className = modeBtnClass(mode === getCutMode(), false);
    btn.textContent = label;
    btn.addEventListener('click', () => triggerMode(mode));
    modeButtons.set(mode, btn);
    modeRow.appendChild(btn);
  }
  content.appendChild(modeRow);

  // Sync shape/mode buttons on gizmo changes; auto-preview after 300 ms idle
  onGizmoChange(() => {
    for (const [s, b] of shapeButtons) b.className = toggleBtnClass(s === getCutShape());
    updateModeButtons();
    syncPositionInputs();
    // Debounced auto-preview: fires 300 ms after the last gizmo change
    if (autoPreviewTimer !== null) clearTimeout(autoPreviewTimer);
    autoPreviewTimer = setTimeout(() => {
      autoPreviewTimer = null;
      if (!applying && isCutOpen()) void applyCut();
    }, 300);
  });

  // === Keep side ===
  appendSectionLabel(content, 'Keep Side');
  const sideRow = document.createElement('div');
  sideRow.className = 'grid grid-cols-2 gap-1 mt-1';
  const sides: [KeepSide, string, string][] = [
    ['outside', '↑ Outside', 'Keep the region outside the cutter (or the +Z side for plane)'],
    ['inside',  '↓ Inside',  'Keep the region inside the cutter (or the −Z side for plane)'],
  ];
  const sideButtons = new Map<KeepSide, HTMLButtonElement>();
  for (const [side, label, tooltip] of sides) {
    const btn = buildToggleBtn(label, tooltip, side === getKeepSide());
    btn.addEventListener('click', () => {
      setKeepSide(side);
      for (const [s, b] of sideButtons) b.className = toggleBtnClass(s === getKeepSide());
    });
    sideButtons.set(side, btn);
    sideRow.appendChild(btn);
  }
  content.appendChild(sideRow);

  // === Position (XYZ inputs) ===
  appendSectionLabel(content, 'Position');
  const posRow = document.createElement('div');
  posRow.className = 'grid grid-cols-3 gap-1 mt-1';

  function makeAxisInput(axis: string): HTMLInputElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col items-center gap-0.5';
    const lbl = document.createElement('div');
    lbl.className = 'text-[9px] text-zinc-500 font-medium';
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '0.1';
    inp.value = '0';
    inp.className = 'w-full text-[10px] text-zinc-200 bg-zinc-700/60 border border-zinc-600/50 rounded px-1 py-0.5 text-center tabular-nums';
    inp.addEventListener('change', () => {
      if (updatingInputs) return;
      const x = parseFloat(posXInput?.value ?? '0') || 0;
      const y = parseFloat(posYInput?.value ?? '0') || 0;
      const z = parseFloat(posZInput?.value ?? '0') || 0;
      setProxyPosition(x, y, z);
    });
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    posRow.appendChild(wrap);
    return inp;
  }

  posXInput = makeAxisInput('X');
  posYInput = makeAxisInput('Y');
  posZInput = makeAxisInput('Z');
  content.appendChild(posRow);

  // === Snap presets ===
  appendSectionLabel(content, 'Snap to Axis %');
  const snapGrid = document.createElement('div');
  snapGrid.className = 'grid gap-1 mt-1';
  snapGrid.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';

  const percentages: [number, string][] = [[0.25, '25%'], [0.5, '50%'], [0.75, '75%']];
  for (const axis of ['X', 'Y', 'Z'] as const) {
    const axisLbl = document.createElement('div');
    axisLbl.className = 'text-[10px] text-zinc-500 font-medium self-center';
    axisLbl.textContent = axis;
    snapGrid.appendChild(axisLbl);

    for (const [pct, label] of percentages) {
      const btn = document.createElement('button');
      btn.className = 'px-1 py-0.5 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const mesh = handlers?.getMesh();
        const pos = getProxyPosition();
        if (!mesh || !pos) return;
        const bb = meshBounds(mesh);
        const axisIdx = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
        const val = bb.min[axisIdx] + (bb.max[axisIdx] - bb.min[axisIdx]) * pct;
        const nx = axis === 'X' ? val : pos[0];
        const ny = axis === 'Y' ? val : pos[1];
        const nz = axis === 'Z' ? val : pos[2];
        setProxyPosition(nx, ny, nz);
        syncPositionInputs();
      });
      snapGrid.appendChild(btn);
    }
  }
  content.appendChild(snapGrid);

  // === Face align ===
  appendSectionLabel(content, 'Align to Face');
  const faceAlignRow = document.createElement('div');
  faceAlignRow.className = 'mt-1';
  const faceAlignBtn = document.createElement('button');
  faceAlignBtn.className = 'w-full px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors';
  faceAlignBtn.textContent = '⊙ Click a face to align';
  faceAlignBtn.title = "Click this button, then click a face on the model to snap the cutter to that face's normal";
  faceAlignBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (faceAlignMode) {
      cancelFaceAlign();
      faceAlignBtn.textContent = '⊙ Click a face to align';
      faceAlignBtn.className = 'w-full px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors';
      return;
    }
    faceAlignMode = true;
    faceAlignBtn.textContent = '⊙ Waiting for click… (Esc to cancel)';
    faceAlignBtn.className = 'w-full px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors';
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.cursor = 'crosshair';
    faceAlignClickHandler = (ev: MouseEvent) => {
      const hit = pickModelFace(ev.clientX, ev.clientY);
      if (hit) {
        snapToFaceNormal(hit.normal);
        syncPositionInputs();
      }
      cancelFaceAlign();
      faceAlignBtn.textContent = '⊙ Click a face to align';
      faceAlignBtn.className = 'w-full px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors';
    };
    document.addEventListener('click', faceAlignClickHandler, { capture: true });
  });
  faceAlignRow.appendChild(faceAlignBtn);
  content.appendChild(faceAlignRow);

  // === Save result mode: separate parts vs combined ===
  appendSectionLabel(content, 'Save As');
  const modeToggleRow = document.createElement('div');
  modeToggleRow.className = 'grid grid-cols-2 gap-1 mt-1';
  const resultModes: [CutResultMode, string, string][] = [
    ['separate', '⧉ Separate', 'Each cut piece becomes its own part in the session'],
    ['combined', '▣ Combined', 'All cut pieces are merged into a single part'],
  ];
  const modeToggleBtns = new Map<CutResultMode, HTMLButtonElement>();
  for (const [mode, label, tooltip] of resultModes) {
    const btn = buildToggleBtn(label, tooltip, mode === cutResultMode);
    btn.addEventListener('click', () => {
      cutResultMode = mode;
      for (const [m, b] of modeToggleBtns) b.className = toggleBtnClass(m === cutResultMode);
    });
    modeToggleBtns.set(mode, btn);
    modeToggleRow.appendChild(btn);
  }
  content.appendChild(modeToggleRow);

  // === Options (preserve colors + show handles) ===
  const optionsRow = document.createElement('div');
  optionsRow.className = 'flex flex-col gap-1.5';

  const colorsLabel = document.createElement('label');
  colorsLabel.className = 'flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer';
  const colorsCheck = document.createElement('input');
  colorsCheck.type = 'checkbox';
  colorsCheck.checked = preserveColors;
  colorsCheck.className = 'w-3.5 h-3.5 rounded accent-blue-500';
  colorsCheck.addEventListener('change', () => { preserveColors = colorsCheck.checked; });
  colorsLabel.appendChild(colorsCheck);
  colorsLabel.appendChild(document.createTextNode('Preserve colors'));
  optionsRow.appendChild(colorsLabel);

  const handlesLabel = document.createElement('label');
  handlesLabel.className = 'flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer';
  const handlesCheck = document.createElement('input');
  handlesCheck.type = 'checkbox';
  handlesCheck.checked = showHandles;
  handlesCheck.className = 'w-3.5 h-3.5 rounded accent-blue-500';
  handlesCheck.addEventListener('change', () => {
    showHandles = handlesCheck.checked;
    setGizmoHandlesVisible(showHandles);
  });
  handlesLabel.appendChild(handlesCheck);
  handlesLabel.appendChild(document.createTextNode('Show gizmo handles'));
  optionsRow.appendChild(handlesLabel);

  content.appendChild(optionsRow);

  // === Status line ===
  statusEl = document.createElement('div');
  statusEl.className = 'text-[10px] text-zinc-400 min-h-[1rem] leading-snug';
  content.appendChild(statusEl);

  // ── Footer ────────────────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-t border-zinc-700 bg-zinc-800/95';

  applyBtn = document.createElement('button');
  applyBtn.className = [
    'flex-1 px-2 py-1.5 rounded text-[11px]',
    'bg-blue-600/80 text-white hover:bg-blue-500/80 transition-colors font-medium',
  ].join(' ');
  applyBtn.textContent = 'Apply Cut';
  applyBtn.title = 'Apply the cut to the model (shown live — then Save to bake it)';
  applyBtn.addEventListener('click', () => { void applyCut(); });
  footer.appendChild(applyBtn);

  saveBtn = document.createElement('button');
  saveBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors disabled:opacity-40';
  saveBtn.textContent = 'Save';
  saveBtn.title = 'Save the cut result as a new version';
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', () => { void doSave(); });
  footer.appendChild(saveBtn);

  p.appendChild(footer);
  return p;
}

function syncPositionInputs(): void {
  const pos = getProxyPosition();
  if (!pos || !posXInput || !posYInput || !posZInput) return;
  updatingInputs = true;
  posXInput.value = pos[0].toFixed(2);
  posYInput.value = pos[1].toFixed(2);
  posZInput.value = pos[2].toFixed(2);
  updatingInputs = false;
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function applyCut(): Promise<void> {
  if (!handlers || applying) return;
  const params = getParams();
  applying = true;
  setButtonsDisabled(true);
  if (statusEl) statusEl.textContent = 'Applying cut…';
  try {
    const result = await handlers.apply(params, preserveColors);
    if (result) {
      const partsNote = result.componentCount > 1
        ? ` → ${result.componentCount} parts`
        : '';
      if (statusEl) statusEl.textContent = `Cut applied — ${result.triangleCount.toLocaleString()} triangles${partsNote}. Click Save to bake.`;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-emerald-700/60 text-emerald-200 hover:bg-emerald-600/60 transition-colors';
      }
    } else {
      if (statusEl) statusEl.textContent = 'Cut produced no result — the shape may not intersect the model.';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Error: ${(e as Error).message}`;
  } finally {
    applying = false;
    setButtonsDisabled(false);
  }
}

async function doSave(): Promise<void> {
  if (!handlers || applying) return;
  applying = true;
  setButtonsDisabled(true);
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    const res = await handlers.save(cutResultMode);
    if (statusEl) statusEl.textContent = res.message;
    if (res.ok && saveBtn) {
      saveBtn.disabled = true;
      saveBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Save failed: ${(e as Error).message}`;
  } finally {
    applying = false;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled: boolean): void {
  if (applyBtn) applyBtn.disabled = disabled;
  // saveBtn remains in its own enabled/disabled state
}

// ── Helper UI utilities ────────────────────────────────────────────────────────

function appendSectionLabel(container: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  el.textContent = text;
  container.appendChild(el);
}

function buildToggleBtn(label: string, tooltip: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = toggleBtnClass(active);
  btn.textContent = label;
  btn.title = tooltip;
  return btn;
}

function toggleBtnClass(active: boolean): string {
  return active
    ? 'px-1.5 py-1 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center'
    : 'px-1.5 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

function modeBtnClass(active: boolean, disabled: boolean): string {
  if (disabled) {
    return 'px-1.5 py-1 rounded text-[10px] bg-zinc-800/40 text-zinc-600 border border-transparent text-center opacity-40 cursor-not-allowed';
  }
  return active
    ? 'px-1.5 py-1 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center'
    : 'px-1.5 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

