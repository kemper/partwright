// Cut tool UI — viewport-overlay "✂ Cut" button + floating panel.
// Follows the simplifyUI.ts pattern: button in clipControls, panel appended to
// the same container, open/close, forceDeactivate(), and CutHandlers injected
// from main.ts.
//
// The panel lets the user:
//   1. Choose a cut shape (plane/box/sphere/cylinder) and gizmo mode.
//   2. Choose which side to keep (outside/inside).
//   3. Optionally preserve triangle colors after the cut.
//   4. Apply the cut (runs in the geometry Worker via cutInWorker).
//   5. Save the result as a new session version.

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
  type CutShape,
  type CutMode,
  type KeepSide,
  type CutGizmoParams,
} from '../cut/cutGizmo';
import type { MeshData } from '../geometry/types';

export type { CutGizmoParams };

export interface CutApplyResult {
  triangleCount: number;
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
  save(): Promise<CutSaveResult>;
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

let preserveColors = true;

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
  const simplifyBtn = controlsContainer.querySelector('#simplify-toggle');
  if (simplifyBtn) controlsContainer.insertBefore(cutBtn, simplifyBtn);
  else controlsContainer.appendChild(cutBtn);

  panel = buildPanel();
  controlsContainer.appendChild(panel);
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
    // Show the reason briefly in the status area (panel is not open yet).
    if (statusEl) statusEl.textContent = res.reason;
    return;
  }
  panel.classList.remove('hidden');
  if (cutBtn) cutBtn.className = BTN_ACTIVE;
  // Activate the 3-D gizmo.
  const mesh = handlers.getMesh();
  if (mesh) activateGizmo(mesh);
}

function closePanel(): void {
  panel?.classList.add('hidden');
  if (cutBtn) cutBtn.className = BTN_INACTIVE;
  deactivateGizmo();
}

// ── Panel builder ──────────────────────────────────────────────────────────────

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'cut-panel';
  // Responsive: full-width bottom sheet on mobile, floating sidebar on desktop.
  p.className = [
    'hidden z-20 flex flex-col overflow-hidden',
    'bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl',
    'absolute inset-x-2 bottom-2 top-auto max-h-[55%] rounded-xl',
    'md:inset-x-auto md:bottom-auto md:left-auto md:right-2 md:top-12',
    'md:w-64 md:max-h-[calc(100%-3.5rem)] md:rounded-lg',
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

  makeDraggable(p, header);

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
  // Sync shape buttons when the gizmo notifies us (e.g. after onMeshChanged rebuilds).
  onGizmoChange(() => {
    for (const [s, b] of shapeButtons) b.className = toggleBtnClass(s === getCutShape());
  });
  content.appendChild(shapeRow);

  // === Gizmo mode ===
  appendSectionLabel(content, 'Gizmo Mode');
  const modeRow = document.createElement('div');
  modeRow.className = 'grid grid-cols-3 gap-1 mt-1';
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

  for (const [mode, label] of modes) {
    const btn = document.createElement('button');
    btn.className = modeBtnClass(mode === getCutMode(), false);
    btn.textContent = label;
    btn.addEventListener('click', () => {
      setCutMode(mode);
      for (const [m, b] of modeButtons) {
        b.className = modeBtnClass(m === mode, false);
      }
    });
    modeButtons.set(mode, btn);
    modeRow.appendChild(btn);
  }
  content.appendChild(modeRow);

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

  // === Preserve colors ===
  const colorsLabel = document.createElement('label');
  colorsLabel.className = 'flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer';
  const colorsCheck = document.createElement('input');
  colorsCheck.type = 'checkbox';
  colorsCheck.checked = preserveColors;
  colorsCheck.className = 'w-3.5 h-3.5 rounded accent-blue-500';
  colorsCheck.addEventListener('change', () => { preserveColors = colorsCheck.checked; });
  colorsLabel.appendChild(colorsCheck);
  colorsLabel.appendChild(document.createTextNode('Preserve colors'));
  content.appendChild(colorsLabel);

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
      if (statusEl) statusEl.textContent = `Cut applied — ${result.triangleCount.toLocaleString()} triangles. Click Save to bake.`;
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
    const res = await handlers.save();
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

/** Make an element draggable on desktop by its header. Uses Pointer Events API. */
function makeDraggable(el: HTMLElement, handle: HTMLElement): void {
  let startX = 0, startY = 0, startRight = 0, startTop = 0;

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Dragging only makes sense on desktop (md+).
    if (window.matchMedia('(max-width: 767px)').matches) return;
    handle.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startRight = window.innerWidth - rect.right;
    startTop = rect.top;
    // Switch from Tailwind positioning classes to explicit inline style.
    el.style.right = `${startRight}px`;
    el.style.top = `${startTop}px`;
    el.classList.remove('md:right-2', 'md:top-12');
  });

  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.right = `${Math.max(0, startRight - dx)}px`;
    el.style.top = `${Math.max(0, startTop + dy)}px`;
  });
}
