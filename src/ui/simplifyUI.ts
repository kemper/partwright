// Simplify/Enhance mode UI — a viewport-overlay button that opens a popup panel
// for either reducing (simplify) or increasing (enhance) the model's triangle
// count. A mode toggle switches between the two operations; a "Preserve colors
// (best-effort)" checkbox carries paint through the topology change via
// nearest-triangle centroid transfer. The shared progress modal (with a Cancel
// button) tracks the worker search on heavy models.
//
// Opening the panel auto-enables the viewport's mesh-edges (wireframe) overlay
// so the user can see what they're changing, and restores the previous setting
// on close. Operations run in the geometry Worker; closing the panel doesn't
// cancel them, and reopening shows the in-flight state.
//
// This module is intentionally a leaf: it never imports the other overlay tools
// (paint / annotate / measure). Those modules call forceDeactivate() here when
// they open, and opening Simplify closes them via the injected handlers.open().

import { startProgress, updateProgress, endProgress } from './progressModal';
import { isWireframeVisible, setWireframeVisible } from '../renderer/viewport';

export interface SimplifyOpenInfo {
  baseTriangles: number;
  currentTriangles: number;
  /** True when the model carries paint that could be preserved. */
  hasColor: boolean;
}

export interface SimplifySaveResult {
  ok: boolean;
  message: string;
}

/** Reports apply/enhance progress as a fraction in [0, 1]. */
export type SimplifyProgress = (fraction: number) => void | Promise<void>;

export type SimplifyMode = 'simplify' | 'enhance';

export interface SimplifyHandlers {
  /** Snapshot the current model as the baseline. Returns its triangle count
   *  (and the count currently on screen), or a reason when the model can't be
   *  operated on right now. When `userInitiated` is true the implementation
   *  should also close other overlay tools so panels don't stack. */
  open(userInitiated: boolean): { ok: true; info: SimplifyOpenInfo } | { ok: false; reason: string };
  /** Simplify the baseline down to at most `targetTriangles` and show it live.
   *  `preserveColor` carries paint through the topology change. Returns the
   *  achieved triangle count, null if nothing changed, or throws an AbortError
   *  when cancelled. */
  apply(
    targetTriangles: number,
    preserveColor: boolean,
    onProgress: SimplifyProgress,
    signal?: AbortSignal,
  ): Promise<{ triangleCount: number } | null>;
  /** Enhance the baseline up toward `targetTriangles` and show it live.
   *  `preserveColor` carries paint through the topology change. */
  enhance(
    targetTriangles: number,
    preserveColor: boolean,
    onProgress: SimplifyProgress,
    signal?: AbortSignal,
  ): Promise<{ triangleCount: number } | null>;
  /** Restore the baseline mesh to the viewport (with original colors). */
  reset(): void;
  /** Bake the mesh currently on screen into a new saved version. */
  save(): Promise<SimplifySaveResult>;
}

const BTN_INACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const BTN_ACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';
const MODE_INACTIVE = 'flex-1 px-2 py-1 rounded text-xs text-zinc-400 bg-zinc-700/50 [@media(hover:hover)]:hover:bg-zinc-600/50 transition-colors border border-zinc-600/40';
const MODE_ACTIVE = 'flex-1 px-2 py-1 rounded text-xs text-blue-300 bg-blue-500/20 transition-colors border border-blue-500/40';

let simplifyBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let slider: HTMLInputElement | null = null;
let numberInput: HTMLInputElement | null = null;
let originalEl: HTMLElement | null = null;
let resultEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let controlsEl: HTMLElement | null = null;
let applyBtn: HTMLButtonElement | null = null;
let resetBtn: HTMLButtonElement | null = null;
let saveBtn: HTMLButtonElement | null = null;
let colorCheckbox: HTMLInputElement | null = null;
let colorRow: HTMLElement | null = null;
let simplifyModeBtn: HTMLButtonElement | null = null;
let enhanceModeBtn: HTMLButtonElement | null = null;
let handlers: SimplifyHandlers | null = null;
let info: SimplifyOpenInfo | null = null;
let mode: SimplifyMode = 'simplify';
// The target reflected in the live mesh (Apply is a no-op until it changes).
let appliedTarget = 0;
// The mode that was active when the last apply ran.
let appliedMode: SimplifyMode = 'simplify';
// The triangle count currently on screen (drives the Save button's enabled
// state) — set every time the applied result changes.
let appliedCount = 0;
let applying = false;
/** AbortController for the in-flight apply/enhance. Lives across panel
 *  close/reopen so the modal's Cancel button reaches the right worker job. */
let applyAbort: AbortController | null = null;
/** The viewport wireframe state captured when the panel opened. */
let prevWireframeVisible: boolean | null = null;
/** Whether color preservation is currently requested. */
let preserveColor = true;

export function initSimplifyUI(controlsContainer: HTMLElement, h: SimplifyHandlers): void {
  handlers = h;

  simplifyBtn = document.createElement('button');
  simplifyBtn.id = 'simplify-toggle';
  simplifyBtn.className = BTN_INACTIVE;
  simplifyBtn.textContent = '⬢ Simplify';
  simplifyBtn.title = 'Reduce or enhance the model’s triangle count';
  simplifyBtn.addEventListener('click', toggle);

  // Sit immediately before Measure so the overlay reads Paint · Simplify · Measure.
  const measureBtn = controlsContainer.querySelector('#measure-toggle');
  if (measureBtn) {
    controlsContainer.insertBefore(simplifyBtn, measureBtn);
  } else {
    controlsContainer.appendChild(simplifyBtn);
  }

  panel = buildPanel();
  controlsContainer.appendChild(panel);
}

export function isSimplifyOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

/** Re-read the model into the panel if it's open. Call after the geometry
 *  changes underneath the panel (a code run, version switch, or save). */
export function refreshSimplifyIfOpen(): void {
  if (isSimplifyOpen()) refresh(false);
}

/** Close the panel without touching the applied geometry. */
export function forceDeactivate(): void {
  if (!isSimplifyOpen()) return;
  closePanel();
}

function toggle(): void {
  if (isSimplifyOpen()) {
    closePanel();
  } else {
    openPanel();
  }
}

function openPanel(): void {
  if (!handlers || !panel) return;
  panel.classList.remove('hidden');
  if (simplifyBtn) simplifyBtn.className = BTN_ACTIVE;
  if (prevWireframeVisible === null) {
    prevWireframeVisible = isWireframeVisible();
    if (!prevWireframeVisible) setWireframeVisible(true);
  }
  refresh(true);
}

function refresh(userInitiated: boolean): void {
  if (!handlers) return;
  const res = handlers.open(userInitiated);
  if (!res.ok) {
    info = null;
    showUnavailable(res.reason);
    return;
  }

  info = res.info;
  showControls();

  // Show/hide the color preservation row based on whether the model has paint.
  if (colorRow) colorRow.classList.toggle('hidden', !info.hasColor);

  syncModeUI();
  if (!applying) appliedTarget = info.currentTriangles;
  if (originalEl) originalEl.textContent = `Original: ${info.baseTriangles.toLocaleString()} triangles`;
  if (statusEl) statusEl.textContent = applying ? 'Working… (progress shown in the modal)' : '';
  showResult(info.currentTriangles);
  if (applying) setControlsDisabled(true);
  else updateApplyEnabled();
}

/** Sync slider/input bounds and label for the current mode. */
function syncModeUI(): void {
  if (!info || !slider || !numberInput) return;
  const base = info.baseTriangles;

  if (simplifyModeBtn) simplifyModeBtn.className = mode === 'simplify' ? MODE_ACTIVE : MODE_INACTIVE;
  if (enhanceModeBtn)  enhanceModeBtn.className  = mode === 'enhance'  ? MODE_ACTIVE : MODE_INACTIVE;

  if (mode === 'simplify') {
    const min = Math.max(4, Math.min(base, Math.round(base * 0.02) || 4));
    slider.min = String(min);
    slider.max = String(base);
    slider.value = String(info.currentTriangles);
    numberInput.min = String(min);
    numberInput.max = String(base);
    numberInput.value = String(info.currentTriangles);
  } else {
    // Enhance: slider goes up to 8× base, but the number input accepts any
    // value ≥ base — the user can type beyond the slider range.
    const max = base * 8;
    const defaultTarget = base * 2;
    slider.min = String(base);
    slider.max = String(max);
    slider.value = String(defaultTarget);
    numberInput.min = String(base);
    numberInput.removeAttribute('max');
    numberInput.value = String(defaultTarget);
  }
}

function closePanel(): void {
  panel?.classList.add('hidden');
  if (simplifyBtn) simplifyBtn.className = BTN_INACTIVE;
  if (prevWireframeVisible !== null) {
    setWireframeVisible(prevWireframeVisible);
    prevWireframeVisible = null;
  }
}

function showUnavailable(reason: string): void {
  if (controlsEl) controlsEl.classList.add('hidden');
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = reason;
  }
}

function showControls(): void {
  if (controlsEl) controlsEl.classList.remove('hidden');
  if (statusEl) statusEl.textContent = '';
}

function showResult(count: number): void {
  if (!info || !resultEl) return;
  appliedCount = count;
  const base = info.baseTriangles;
  if (count < base) {
    const pct = base > 0 ? Math.round((1 - count / base) * 100) : 0;
    resultEl.textContent = `Result: ${count.toLocaleString()} triangles (−${pct}%)`;
  } else if (count > base) {
    const pct = base > 0 ? Math.round((count / base - 1) * 100) : 0;
    resultEl.textContent = `Result: ${count.toLocaleString()} triangles (+${pct}%)`;
  } else {
    resultEl.textContent = `Result: ${count.toLocaleString()} triangles`;
  }
  updateSaveEnabled();
}

function clampTarget(raw: number): number {
  if (!info) return raw;
  const min = Number(slider?.min ?? 4);
  if (!Number.isFinite(raw)) return mode === 'simplify' ? info.baseTriangles : info.baseTriangles * 2;
  // Enhance: only enforce the minimum — the user can type beyond the slider range.
  if (mode === 'enhance') return Math.max(min, Math.round(raw));
  const max = Number(slider?.max ?? info.baseTriangles);
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function currentTarget(): number {
  return clampTarget(Number(numberInput?.value ?? slider?.value ?? appliedTarget));
}

function updateApplyEnabled(): void {
  if (!applyBtn) return;
  applyBtn.disabled = applying || !info || (currentTarget() === appliedTarget && mode === appliedMode);
}

function updateSaveEnabled(): void {
  if (!saveBtn) return;
  saveBtn.disabled = applying || !info || appliedCount === info.baseTriangles;
}

function setControlsDisabled(disabled: boolean): void {
  if (slider) slider.disabled = disabled;
  if (numberInput) numberInput.disabled = disabled;
  if (resetBtn) resetBtn.disabled = disabled;
  if (simplifyModeBtn) simplifyModeBtn.disabled = disabled;
  if (enhanceModeBtn) enhanceModeBtn.disabled = disabled;
  if (colorCheckbox) colorCheckbox.disabled = disabled;
  if (disabled) {
    if (applyBtn) applyBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    updateApplyEnabled();
    updateSaveEnabled();
  }
}

async function runApply(): Promise<void> {
  if (!handlers || !info || applying) return;
  const target = currentTarget();
  if (target === appliedTarget && mode === appliedMode) return;
  const baseline = info;
  const currentMode = mode;
  const doPreserveColor = preserveColor && info.hasColor;

  applying = true;
  applyAbort = new AbortController();
  const abort = applyAbort;
  setControlsDisabled(true);
  if (statusEl) statusEl.textContent = '';

  const title = currentMode === 'simplify' ? 'Simplifying mesh' : 'Enhancing mesh';
  const searchMsg = currentMode === 'simplify'
    ? 'Searching for the gentlest tolerance…'
    : 'Searching for the finest edge length…';

  const progressId = startProgress({
    title,
    message: searchMsg,
    onCancel: () => abort.abort(),
  });

  try {
    const handler = currentMode === 'simplify' ? handlers.apply : handlers.enhance;
    const r = await handler.call(
      handlers,
      target,
      doPreserveColor,
      (fraction) => {
        const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
        updateProgress(progressId, fraction, `${currentMode === 'simplify' ? 'Simplifying' : 'Enhancing'}… ${pct}%`);
      },
      abort.signal,
    );
    appliedTarget = target;
    appliedMode = currentMode;
    showResult(r ? r.triangleCount : baseline.baseTriangles);
    if (statusEl) statusEl.textContent = '';
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'AbortError') {
      if (statusEl) statusEl.textContent = 'Cancelled.';
    } else {
      if (statusEl) statusEl.textContent = `${currentMode === 'simplify' ? 'Simplify' : 'Enhance'} failed: ${err.message}`;
    }
  } finally {
    applying = false;
    applyAbort = null;
    endProgress(progressId);
    setControlsDisabled(false);
  }
}

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'simplify-panel';
  p.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  p.style.minWidth = '240px';
  p.style.maxWidth = '280px';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-1.5';
  const titleEl = document.createElement('div');
  titleEl.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  titleEl.textContent = 'Simplify / Enhance';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-500 [@media(hover:hover)]:hover:text-zinc-200 transition-colors leading-none text-base';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', closePanel);
  header.append(titleEl, closeBtn);
  p.appendChild(header);

  originalEl = document.createElement('div');
  originalEl.id = 'simplify-original';
  originalEl.className = 'text-xs text-zinc-300 mb-2';
  originalEl.textContent = 'Original: —';
  p.appendChild(originalEl);

  // Mode toggle: Simplify | Enhance
  const modeRow = document.createElement('div');
  modeRow.className = 'flex gap-1 mb-2';

  simplifyModeBtn = document.createElement('button');
  simplifyModeBtn.textContent = 'Simplify';
  simplifyModeBtn.title = 'Reduce triangle count';
  simplifyModeBtn.className = MODE_ACTIVE;
  simplifyModeBtn.addEventListener('click', () => {
    if (applying || mode === 'simplify') return;
    mode = 'simplify';
    if (info) syncModeUI();
    updateApplyEnabled();
  });
  modeRow.appendChild(simplifyModeBtn);

  enhanceModeBtn = document.createElement('button');
  enhanceModeBtn.textContent = 'Enhance';
  enhanceModeBtn.title = 'Increase triangle count for smoother geometry';
  enhanceModeBtn.className = MODE_INACTIVE;
  enhanceModeBtn.addEventListener('click', () => {
    if (applying || mode === 'enhance') return;
    mode = 'enhance';
    if (info) syncModeUI();
    updateApplyEnabled();
  });
  modeRow.appendChild(enhanceModeBtn);
  p.appendChild(modeRow);

  // Controls wrapper (hidden when no model is available)
  controlsEl = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Target triangles';
  label.htmlFor = 'simplify-input';
  controlsEl.appendChild(label);

  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 mb-2';

  slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'simplify-slider';
  slider.className = 'flex-1 accent-blue-400 cursor-pointer';
  slider.min = '4';
  slider.max = '100';
  slider.step = '1';
  slider.value = '100';
  slider.addEventListener('input', () => {
    if (applying) return;
    const t = clampTarget(Number(slider!.value));
    if (numberInput) numberInput.value = String(t);
    updateApplyEnabled();
  });
  row.appendChild(slider);

  numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.id = 'simplify-input';
  numberInput.className = 'w-20 px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';
  numberInput.min = '4';
  numberInput.step = '1';
  numberInput.addEventListener('input', () => {
    if (applying) return;
    const t = clampTarget(Number(numberInput!.value));
    if (slider) slider.value = String(Math.min(Number(slider.max), t));
    updateApplyEnabled();
  });
  numberInput.addEventListener('change', () => {
    if (applying) return;
    const t = clampTarget(Number(numberInput!.value));
    numberInput!.value = String(t);
    if (slider) slider.value = String(Math.min(Number(slider.max), t));
    updateApplyEnabled();
  });
  row.appendChild(numberInput);
  controlsEl.appendChild(row);

  // Color preservation (hidden when model has no paint)
  colorRow = document.createElement('div');
  colorRow.className = 'hidden flex items-center gap-1.5 mb-2';
  colorCheckbox = document.createElement('input');
  colorCheckbox.type = 'checkbox';
  colorCheckbox.id = 'simplify-preserve-color';
  colorCheckbox.className = 'accent-blue-400 cursor-pointer';
  colorCheckbox.checked = true;
  colorCheckbox.addEventListener('change', () => {
    preserveColor = colorCheckbox!.checked;
    updateApplyEnabled();
  });
  const colorLabel = document.createElement('label');
  colorLabel.htmlFor = 'simplify-preserve-color';
  colorLabel.className = 'text-xs text-zinc-300 cursor-pointer select-none';
  colorLabel.textContent = 'Preserve colors (best-effort)';
  colorRow.append(colorCheckbox, colorLabel);
  controlsEl.appendChild(colorRow);

  applyBtn = document.createElement('button');
  applyBtn.id = 'simplify-apply';
  applyBtn.className = 'w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed mb-2';
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Apply the target triangle count';
  applyBtn.disabled = true;
  applyBtn.addEventListener('click', () => { void runApply(); });
  controlsEl.appendChild(applyBtn);

  resultEl = document.createElement('div');
  resultEl.id = 'simplify-result';
  resultEl.className = 'text-xs text-blue-300 mb-2.5';
  resultEl.textContent = 'Result: —';
  controlsEl.appendChild(resultEl);

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2';

  resetBtn = document.createElement('button');
  resetBtn.id = 'simplify-reset';
  resetBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-700/70 text-zinc-300 [@media(hover:hover)]:hover:bg-zinc-600/70 transition-colors border border-zinc-600/50';
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Restore the original mesh';
  resetBtn.addEventListener('click', () => {
    if (!info || applying) return;
    handlers?.reset();
    appliedTarget = info.baseTriangles;
    appliedMode = 'simplify';
    if (slider) slider.value = String(info.currentTriangles);
    if (numberInput) numberInput.value = String(info.currentTriangles);
    showResult(info.baseTriangles);
    if (statusEl) statusEl.textContent = '';
    updateApplyEnabled();
  });
  actions.appendChild(resetBtn);

  saveBtn = document.createElement('button');
  saveBtn.id = 'simplify-save';
  saveBtn.className = 'px-2 py-1 rounded text-xs bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
  saveBtn.textContent = 'Save as version';
  saveBtn.title = 'Bake the current mesh into a new saved version';
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    if (!handlers || !saveBtn || applying) return;
    saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';
    const res = await handlers.save();
    if (res.ok) refresh(false);
    if (statusEl) statusEl.textContent = res.message;
  });
  actions.appendChild(saveBtn);
  controlsEl.appendChild(actions);

  p.appendChild(controlsEl);

  statusEl = document.createElement('div');
  statusEl.id = 'simplify-status';
  statusEl.className = 'text-xs text-zinc-400 mt-2';
  p.appendChild(statusEl);

  return p;
}
