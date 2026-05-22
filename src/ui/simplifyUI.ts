// Simplify mode UI — a viewport-overlay button (next to Measure) that opens a
// popup panel for reducing the model's triangle count. The user drags a slider
// or types an exact "max triangles" value, then clicks Apply to run the
// reduction; a progress bar tracks the (potentially slow) search on heavy
// models. An optional "Save as version" bakes the reduced mesh into a new saved
// version.
//
// This module is intentionally a leaf: it never imports the other overlay tools
// (paint / annotate / measure). Those modules call forceDeactivate() here when
// they open, and opening Simplify closes them via the injected handlers.open().

export interface SimplifyOpenInfo {
  baseTriangles: number;
  currentTriangles: number;
}

export interface SimplifySaveResult {
  ok: boolean;
  message: string;
}

/** Reports apply progress as a fraction in [0, 1]. Awaited by the handler so
 *  the UI can repaint the progress bar between binary-search iterations. */
export type SimplifyProgress = (fraction: number) => void | Promise<void>;

export interface SimplifyHandlers {
  /** Snapshot the current model as the simplify baseline. Returns its triangle
   *  count (and the count currently on screen), or a reason when the model
   *  can't be simplified right now. When `userInitiated` is true (the user
   *  clicked the toolbar button) the implementation should also close the other
   *  overlay tools so panels don't stack. */
  open(userInitiated: boolean): { ok: true; info: SimplifyOpenInfo } | { ok: false; reason: string };
  /** Simplify the baseline down to at most `targetTriangles` and show it live,
   *  reporting progress via `onProgress`. Returns the achieved triangle count,
   *  or null if nothing changed. */
  apply(targetTriangles: number, onProgress: SimplifyProgress): Promise<{ triangleCount: number } | null>;
  /** Restore the un-simplified baseline mesh to the viewport. */
  reset(): void;
  /** Bake the mesh currently on screen into a new saved version. */
  save(): Promise<SimplifySaveResult>;
}

const BTN_INACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const BTN_ACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';

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
let progressEl: HTMLElement | null = null;
let progressBarEl: HTMLElement | null = null;
let progressLabelEl: HTMLElement | null = null;

let handlers: SimplifyHandlers | null = null;
let info: SimplifyOpenInfo | null = null;
// The target reflected in the live mesh (Apply is a no-op until it changes).
let appliedTarget = 0;
// The triangle count currently on screen (drives the Save button's enabled
// state) — set every time the applied result changes.
let appliedCount = 0;
let applying = false;

export function initSimplifyUI(controlsContainer: HTMLElement, h: SimplifyHandlers): void {
  handlers = h;

  simplifyBtn = document.createElement('button');
  simplifyBtn.id = 'simplify-toggle';
  simplifyBtn.className = BTN_INACTIVE;
  simplifyBtn.textContent = '⬢ Simplify';
  simplifyBtn.title = 'Reduce the model’s triangle count';
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

/** Close the panel without touching the applied geometry. Other overlay tools
 *  call this when they open; Escape calls it too. */
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
  refresh(true);
}

/** (Re)read the current model as the baseline and populate the controls. Used
 *  on open and again after a successful save (the baked mesh becomes the new
 *  baseline). */
function refresh(userInitiated: boolean): void {
  if (!handlers) return;
  // A refresh under a finished apply: clear any leftover progress chrome.
  showProgress(false);
  const res = handlers.open(userInitiated);
  if (!res.ok) {
    info = null;
    showUnavailable(res.reason);
    return;
  }

  info = res.info;
  showControls();

  const base = info.baseTriangles;
  // A small floor keeps the left end of the slider useful without offering
  // targets so low the geometry can't possibly reach them.
  const min = Math.max(4, Math.min(base, Math.round(base * 0.02) || 4));
  if (slider) {
    slider.min = String(min);
    slider.max = String(base);
    slider.value = String(info.currentTriangles);
  }
  if (numberInput) {
    numberInput.min = String(min);
    numberInput.max = String(base);
    numberInput.value = String(info.currentTriangles);
  }
  appliedTarget = info.currentTriangles;
  if (originalEl) originalEl.textContent = `Original: ${base.toLocaleString()} triangles`;
  if (statusEl) statusEl.textContent = '';
  showResult(info.currentTriangles);
  updateApplyEnabled();
}

function closePanel(): void {
  panel?.classList.add('hidden');
  if (simplifyBtn) simplifyBtn.className = BTN_INACTIVE;
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
  const pct = base > 0 ? Math.round((1 - count / base) * 100) : 0;
  resultEl.textContent = `Result: ${count.toLocaleString()} triangles (−${pct}%)`;
  updateSaveEnabled();
}

function clampTarget(raw: number): number {
  if (!info) return raw;
  const min = slider ? Number(slider.min) : 4;
  const max = info.baseTriangles;
  if (!Number.isFinite(raw)) return max;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

/** The target the controls currently express (slider/number input). */
function currentTarget(): number {
  return clampTarget(Number(numberInput?.value ?? slider?.value ?? appliedTarget));
}

function updateApplyEnabled(): void {
  if (!applyBtn) return;
  applyBtn.disabled = applying || !info || currentTarget() === appliedTarget;
}

function updateSaveEnabled(): void {
  if (!saveBtn) return;
  saveBtn.disabled = applying || !info || appliedCount >= info.baseTriangles;
}

/** Lock the controls while an apply runs; unlock re-derives each button's
 *  enabled state from the applied result. */
function setControlsDisabled(disabled: boolean): void {
  if (slider) slider.disabled = disabled;
  if (numberInput) numberInput.disabled = disabled;
  if (resetBtn) resetBtn.disabled = disabled;
  if (disabled) {
    if (applyBtn) applyBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    updateApplyEnabled();
    updateSaveEnabled();
  }
}

function showProgress(show: boolean): void {
  if (!progressEl) return;
  progressEl.classList.toggle('hidden', !show);
  if (show) setProgress(0);
}

function setProgress(fraction: number): void {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  if (progressBarEl) progressBarEl.style.width = `${pct}%`;
  if (progressLabelEl) progressLabelEl.textContent = `Simplifying… ${pct}%`;
}

/** Resolve after the browser has had a chance to paint. The progress bar is
 *  updated just before this runs; a single rAF fires *before* paint, so the
 *  nested rAF resolves only after that frame has actually been drawn — letting
 *  the bar advance visibly between the blocking simplify iterations. */
function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function runApply(): Promise<void> {
  if (!handlers || !info || applying) return;
  const target = currentTarget();
  if (target === appliedTarget) return;

  applying = true;
  setControlsDisabled(true);
  showProgress(true);
  if (statusEl) statusEl.textContent = '';

  try {
    const r = await handlers.apply(target, (fraction) => {
      setProgress(fraction);
      return yieldForPaint();
    });
    appliedTarget = target;
    showResult(r ? r.triangleCount : info.baseTriangles);
  } catch (e) {
    if (statusEl) statusEl.textContent = `Simplify failed: ${(e as Error).message}`;
  } finally {
    applying = false;
    showProgress(false);
    setControlsDisabled(false);
  }
}

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'simplify-panel';
  p.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  p.style.minWidth = '230px';
  p.style.maxWidth = '270px';

  const title = document.createElement('div');
  title.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  title.textContent = 'Simplify mesh';
  p.appendChild(title);

  originalEl = document.createElement('div');
  originalEl.id = 'simplify-original';
  originalEl.className = 'text-xs text-zinc-300 mb-2';
  originalEl.textContent = 'Original: —';
  p.appendChild(originalEl);

  // Wrapper that hides everything interactive when the model can't be simplified.
  controlsEl = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Max triangles';
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
  // Moving the slider only sets the target; Apply runs the reduction.
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
    if (slider) slider.value = String(t);
    updateApplyEnabled();
  });
  numberInput.addEventListener('change', () => {
    if (applying) return;
    const t = clampTarget(Number(numberInput!.value));
    numberInput!.value = String(t);
    if (slider) slider.value = String(t);
    updateApplyEnabled();
  });
  row.appendChild(numberInput);
  controlsEl.appendChild(row);

  applyBtn = document.createElement('button');
  applyBtn.id = 'simplify-apply';
  applyBtn.className = 'w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed mb-2';
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Reduce the mesh to the target triangle count';
  applyBtn.disabled = true;
  applyBtn.addEventListener('click', () => { void runApply(); });
  controlsEl.appendChild(applyBtn);

  // Progress bar shown only while an apply is in flight.
  progressEl = document.createElement('div');
  progressEl.id = 'simplify-progress';
  progressEl.className = 'hidden mb-2';
  const track = document.createElement('div');
  track.className = 'h-1.5 rounded-full bg-zinc-700/70 overflow-hidden';
  progressBarEl = document.createElement('div');
  progressBarEl.id = 'simplify-progress-bar';
  progressBarEl.className = 'h-full bg-blue-400';
  progressBarEl.style.width = '0%';
  track.appendChild(progressBarEl);
  progressEl.appendChild(track);
  progressLabelEl = document.createElement('div');
  progressLabelEl.className = 'text-[10px] text-zinc-400 mt-1';
  progressLabelEl.textContent = 'Simplifying…';
  progressEl.appendChild(progressLabelEl);
  controlsEl.appendChild(progressEl);

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
  resetBtn.title = 'Restore the full-detail mesh';
  resetBtn.addEventListener('click', () => {
    if (!info || applying) return;
    handlers?.reset();
    appliedTarget = info.baseTriangles;
    if (slider) slider.value = String(info.baseTriangles);
    if (numberInput) numberInput.value = String(info.baseTriangles);
    showResult(info.baseTriangles);
    if (statusEl) statusEl.textContent = '';
    updateApplyEnabled();
  });
  actions.appendChild(resetBtn);

  saveBtn = document.createElement('button');
  saveBtn.id = 'simplify-save';
  saveBtn.className = 'px-2 py-1 rounded text-xs bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
  saveBtn.textContent = 'Save as version';
  saveBtn.title = 'Bake the reduced mesh into a new saved version';
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    if (!handlers || !saveBtn || applying) return;
    saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';
    const res = await handlers.save();
    // Re-baseline so the panel reflects the freshly saved (reduced) mesh, then
    // surface the result message (refresh() clears the status line first).
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
