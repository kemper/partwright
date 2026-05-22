// Simplify mode UI — a viewport-overlay button (next to Measure) that opens a
// popup panel for reducing the model's triangle count. The user drags a slider
// or types an exact "max triangles" value; the model re-simplifies live. An
// optional "Save as version" bakes the reduced mesh into a new saved version.
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

export interface SimplifyHandlers {
  /** Snapshot the current model as the simplify baseline. Returns its triangle
   *  count (and the count currently on screen), or a reason when the model
   *  can't be simplified right now. When `userInitiated` is true (the user
   *  clicked the toolbar button) the implementation should also close the other
   *  overlay tools so panels don't stack. */
  open(userInitiated: boolean): { ok: true; info: SimplifyOpenInfo } | { ok: false; reason: string };
  /** Simplify the baseline down to at most `targetTriangles` and show it live.
   *  Returns the achieved triangle count, or null if nothing changed. */
  preview(targetTriangles: number): { triangleCount: number } | null;
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
let resetBtn: HTMLButtonElement | null = null;
let saveBtn: HTMLButtonElement | null = null;

let handlers: SimplifyHandlers | null = null;
let info: SimplifyOpenInfo | null = null;
let previewTimer: number | null = null;

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
  if (originalEl) originalEl.textContent = `Original: ${base.toLocaleString()} triangles`;
  if (statusEl) statusEl.textContent = '';
  showResult(info.currentTriangles);
}

function closePanel(): void {
  if (previewTimer !== null) { clearTimeout(previewTimer); previewTimer = null; }
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
  const base = info.baseTriangles;
  const pct = base > 0 ? Math.round((1 - count / base) * 100) : 0;
  resultEl.textContent = `Result: ${count.toLocaleString()} triangles (−${pct}%)`;
  if (saveBtn) saveBtn.disabled = count >= base;
}

function clampTarget(raw: number): number {
  if (!info) return raw;
  const min = slider ? Number(slider.min) : 4;
  const max = info.baseTriangles;
  if (!Number.isFinite(raw)) return max;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

/** Apply a target triangle count to the live model. Debounced so dragging the
 *  slider doesn't run the (synchronous) binary search on every tick. */
function scheduleApply(target: number): void {
  if (previewTimer !== null) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    applyTarget(target);
  }, 120);
}

function applyTarget(target: number): void {
  if (!handlers || !info) return;
  if (target >= info.baseTriangles) {
    handlers.reset();
    showResult(info.baseTriangles);
    return;
  }
  const r = handlers.preview(target);
  showResult(r ? r.triangleCount : info.baseTriangles);
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
  slider.addEventListener('input', () => {
    const t = clampTarget(Number(slider!.value));
    if (numberInput) numberInput.value = String(t);
    scheduleApply(t);
  });
  // Snap to the precise value the instant the drag ends.
  slider.addEventListener('change', () => applyTarget(clampTarget(Number(slider!.value))));
  row.appendChild(slider);

  numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.id = 'simplify-input';
  numberInput.className = 'w-20 px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';
  numberInput.min = '4';
  numberInput.step = '1';
  numberInput.addEventListener('input', () => {
    const t = clampTarget(Number(numberInput!.value));
    if (slider) slider.value = String(t);
    scheduleApply(t);
  });
  numberInput.addEventListener('change', () => {
    const t = clampTarget(Number(numberInput!.value));
    numberInput!.value = String(t);
    if (slider) slider.value = String(t);
    applyTarget(t);
  });
  row.appendChild(numberInput);
  controlsEl.appendChild(row);

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
    if (!info) return;
    if (previewTimer !== null) { clearTimeout(previewTimer); previewTimer = null; }
    handlers?.reset();
    if (slider) slider.value = String(info.baseTriangles);
    if (numberInput) numberInput.value = String(info.baseTriangles);
    showResult(info.baseTriangles);
    if (statusEl) statusEl.textContent = '';
  });
  actions.appendChild(resetBtn);

  saveBtn = document.createElement('button');
  saveBtn.id = 'simplify-save';
  saveBtn.className = 'px-2 py-1 rounded text-xs bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
  saveBtn.textContent = 'Save as version';
  saveBtn.title = 'Bake the reduced mesh into a new saved version';
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    if (!handlers || !saveBtn) return;
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
