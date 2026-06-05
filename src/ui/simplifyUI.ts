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
import { showToast } from './toast';
import { isWireframeVisible, setWireframeVisible } from '../renderer/viewport';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { QUALITY_OPTIONS, QUALITY_SEGMENTS, loadQualitySettings, type QualitySettings } from '../geometry/qualitySettings';
import { saveQualityForLang, initQualityLogic, notifyLanguageChange as notifyQualityLangChange } from './curvatureQualityPanel';
import type { Language } from '../geometry/engine';

export interface SimplifyOpenInfo {
  baseTriangles: number;
  currentTriangles: number;
  /** True when the model carries paint that could be preserved. */
  hasColor: boolean;
  /** Baseline bounding-box diagonal (mesh units) — bounds the simplify
   *  tolerance / size knobs. */
  bboxDiagonal: number;
  /** Longest edge in the baseline mesh (mesh units) — the upper bound for the
   *  enhance edge-length knob (refining at this length is a no-op). */
  maxEdge: number;
  /** Shortest positive edge in the baseline mesh (mesh units) — a natural
   *  lower bound / default for the enhance edge-length knob ("bring big
   *  triangles down to the size of the small ones"). */
  minEdge: number;
}

export interface SimplifySaveResult {
  ok: boolean;
  message: string;
}

/** Reports apply/enhance progress as a fraction in [0, 1]. */
export type SimplifyProgress = (fraction: number) => void | Promise<void>;

export type SimplifyMode = 'simplify' | 'enhance';

/** Which knob drives the target:
 *  - `count` — target triangle count (binary-searched, the original behavior).
 *  - `edge`  — a direct edge length / tolerance in mesh units (single pass).
 *  - `size`  — a triangle-size threshold + a strength "amount" (single pass);
 *              enhance refines triangles larger than the threshold, simplify
 *              collapses features smaller than it. */
export type KnobMode = 'count' | 'edge' | 'size';

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
  /** Simplify the baseline with a single direct `simplify(tolerance)` pass
   *  (the "by edge length / feature size" knob) and show it live. Returns the
   *  achieved triangle count, or null when nothing fell below the tolerance
   *  (the panel surfaces that as a "nothing to simplify" warning). */
  simplifyByTolerance(
    tolerance: number,
    preserveColor: boolean,
    onProgress: SimplifyProgress,
    signal?: AbortSignal,
  ): Promise<{ triangleCount: number } | null>;
  /** Enhance the baseline with a single direct `refineToLength(edgeLength)`
   *  pass (the "by edge length / triangle size" knob) and show it live. Splits
   *  only edges longer than `edgeLength`, so the larger triangles densify
   *  first. Returns the achieved triangle count, or null when no edge was long
   *  enough (surfaced as a "nothing to enhance" warning). */
  enhanceByEdgeLength(
    edgeLength: number,
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

let qualityRadios: HTMLInputElement[] = [];
let qualityApplyBtn: HTMLButtonElement | null = null;
// The committed (applied) curvature quality to revert to when the panel closes
// without an explicit Apply. Captured on open and updated each time the user
// clicks Apply quality. Picking a radio only *previews* (re-renders live); it's
// not persisted until Apply, and closing the panel reverts an un-applied
// preview so a heavy quality the user was just trying out doesn't stick.
let committedQuality: QualitySettings | null = null;
let stopRenderBtn: HTMLButtonElement | null = null;
let isScadLang = false;
let onCancelRender: (() => void) | null = null;

let simplifyBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let panelHeader: HTMLElement | null = null;
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
// Knob-mode pills (Count / Edge length / Size) + the controls each owns.
let knobCountBtn: HTMLButtonElement | null = null;
let knobEdgeBtn: HTMLButtonElement | null = null;
let knobSizeBtn: HTMLButtonElement | null = null;
let countControls: HTMLElement | null = null;
let lengthControls: HTMLElement | null = null;
let lengthLabel: HTMLLabelElement | null = null;
let lengthSlider: HTMLInputElement | null = null;
let lengthInput: HTMLInputElement | null = null;
let amountRow: HTMLElement | null = null;
let amountSlider: HTMLInputElement | null = null;
let amountValueEl: HTMLElement | null = null;
let handlers: SimplifyHandlers | null = null;
let info: SimplifyOpenInfo | null = null;
let mode: SimplifyMode = 'simplify';
let knobMode: KnobMode = 'count';
// A signature of the request reflected in the live mesh, so Apply stays a
// no-op until the user changes mode / knob / value. Set after each apply,
// refresh, and reset.
let appliedKey = '';
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

export function initSimplifyUI(
  controlsContainer: HTMLElement,
  h: SimplifyHandlers,
  opts: { initialLang: Language; onCancelRender?: () => void },
): void {
  handlers = h;
  isScadLang = opts.initialLang === 'scad';
  onCancelRender = opts.onCancelRender ?? null;
  initQualityLogic(opts.initialLang);

  simplifyBtn = document.createElement('button');
  simplifyBtn.id = 'simplify-toggle';
  simplifyBtn.className = BTN_INACTIVE;
  simplifyBtn.textContent = '○ Quality';
  simplifyBtn.title = 'Adjust curvature quality and simplify or enhance triangle count';
  simplifyBtn.addEventListener('click', toggle);

  // Sit immediately before Measure so the overlay reads Paint · Simplify · Measure.
  const measureBtn = controlsContainer.querySelector('#measure-toggle');
  if (measureBtn) {
    controlsContainer.insertBefore(simplifyBtn, measureBtn);
  } else {
    controlsContainer.appendChild(simplifyBtn);
  }

  panel = buildPanel();
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(panel);
  if (panelHeader) attachViewportPanelDrag(panelHeader, panel);
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

/** Call when the active modeling language changes so quality storage and the
 *  radio display reflect the new language's saved preference. */
export function notifyQualityLangChanged(lang: Language): void {
  notifyQualityLangChange(lang);
  isScadLang = lang === 'scad';
  syncQualityRadios();
  // The language switch silently swaps in that language's quality default, so
  // re-baseline the commit/preview against it.
  committedQuality = { ...loadQualitySettings() };
  updateQualityApplyEnabled();
  if (stopRenderBtn && !isScadLang) stopRenderBtn.classList.add('hidden');
}

/** Call when a code run starts (true) or ends (false) so the Stop button
 *  shows only while a render is actually in progress (SCAD mode only). */
export function setQualityRenderState(isRendering: boolean): void {
  if (!stopRenderBtn) return;
  if (isScadLang && isRendering) {
    stopRenderBtn.classList.remove('hidden');
  } else {
    stopRenderBtn.classList.add('hidden');
  }
}

function syncQualityRadios(): void {
  const current = loadQualitySettings();
  for (const radio of qualityRadios) {
    radio.checked = radio.value === current.quality;
  }
}

function qualityMatches(a: QualitySettings, b: QualitySettings): boolean {
  return a.quality === b.quality && a.customSegments === b.customSegments;
}

/** Enable "Apply quality" only while a previewed quality differs from the
 *  committed one (mirrors the simplify Apply's "no-op stays disabled" rule). */
function updateQualityApplyEnabled(): void {
  if (!qualityApplyBtn) return;
  qualityApplyBtn.disabled = !committedQuality || qualityMatches(loadQualitySettings(), committedQuality);
}

/** Commit the currently-previewed quality so it survives the panel closing. */
function applyQualityPreview(): void {
  committedQuality = { ...loadQualitySettings() };
  updateQualityApplyEnabled();
}

/** Revert an un-applied quality preview back to the committed setting. Called
 *  when the panel closes so a live preview the user didn't Apply doesn't stick. */
function revertQualityPreview(): void {
  if (committedQuality && !qualityMatches(loadQualitySettings(), committedQuality)) {
    onCancelRender?.();
    saveQualityForLang({ ...committedQuality });
  }
  syncQualityRadios();
  updateQualityApplyEnabled();
}

function toggle(): void {
  if (isSimplifyOpen()) {
    closePanel();
  } else {
    openPanel();
  }
}

const registryEntry = { close(): void { if (isSimplifyOpen()) closePanel(); } };

function onSimplifyEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  closePanel();
}

function openPanel(): void {
  if (!handlers || !panel) return;
  setInitialPanelPosition(panel);
  openViewportPanel(registryEntry);
  panel.classList.remove('hidden');
  document.addEventListener('keydown', onSimplifyEscape);
  if (simplifyBtn) simplifyBtn.className = BTN_ACTIVE;
  if (prevWireframeVisible === null) {
    prevWireframeVisible = isWireframeVisible();
    if (!prevWireframeVisible) setWireframeVisible(true);
  }
  // Snapshot the live quality so radio changes preview against it and an
  // un-applied preview reverts here on close.
  committedQuality = { ...loadQualitySettings() };
  syncQualityRadios();
  updateQualityApplyEnabled();
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
  if (!applying) appliedKey = requestKey(currentRequest());
  if (originalEl) originalEl.textContent = `Original: ${info.baseTriangles.toLocaleString()} triangles`;
  if (statusEl) statusEl.textContent = applying ? 'Working… (progress shown in the modal)' : '';
  showResult(info.currentTriangles);
  if (applying) setControlsDisabled(true);
  else updateApplyEnabled();
}

/** Round a length to 3 significant figures for display. */
function fmtLen(v: number): number {
  if (!(v > 0)) return 0;
  return Number(v.toPrecision(3));
}

/** Slider bounds + default for the edge-length / size-threshold knob, derived
 *  from the baseline mesh geometry. Enhance targets an edge length (smaller =
 *  denser); simplify targets a geometric tolerance (larger = coarser). */
function lengthBounds(): { lo: number; hi: number; def: number } {
  if (!info) return { lo: 0, hi: 1, def: 0.5 };
  const maxE = info.maxEdge > 0 ? info.maxEdge : (info.bboxDiagonal || 1);
  const minE = info.minEdge > 0 ? info.minEdge : maxE / 64;
  if (mode === 'enhance') {
    const lo = Math.max(minE, maxE / 64);
    const hi = Math.max(lo * 2, maxE);
    const def = Math.max(lo, Math.min(hi, maxE / 2));
    return { lo, hi, def };
  }
  // simplify: tolerance in mesh units.
  const diag = info.bboxDiagonal > 0 ? info.bboxDiagonal : maxE * 8;
  const hi = diag * 0.25;
  const lo = Math.max(diag * 0.0005, hi / 500);
  const def = Math.max(lo, Math.min(hi, diag * 0.02));
  return { lo, hi, def };
}

/** Sync slider/input bounds, labels, and which control group is visible for the
 *  current mode (simplify/enhance) and knob (count/edge/size). */
function syncModeUI(): void {
  if (!info || !slider || !numberInput) return;
  const base = info.baseTriangles;

  if (simplifyModeBtn) simplifyModeBtn.className = mode === 'simplify' ? MODE_ACTIVE : MODE_INACTIVE;
  if (enhanceModeBtn)  enhanceModeBtn.className  = mode === 'enhance'  ? MODE_ACTIVE : MODE_INACTIVE;

  if (knobCountBtn) knobCountBtn.className = knobMode === 'count' ? MODE_ACTIVE : MODE_INACTIVE;
  if (knobEdgeBtn)  knobEdgeBtn.className  = knobMode === 'edge'  ? MODE_ACTIVE : MODE_INACTIVE;
  if (knobSizeBtn)  knobSizeBtn.className  = knobMode === 'size'  ? MODE_ACTIVE : MODE_INACTIVE;

  if (countControls) countControls.classList.toggle('hidden', knobMode !== 'count');
  if (lengthControls) lengthControls.classList.toggle('hidden', knobMode === 'count');
  if (amountRow) amountRow.classList.toggle('hidden', knobMode !== 'size');

  // Count knob: the original target-triangle slider.
  if (mode === 'simplify') {
    const min = Math.max(4, Math.min(base, Math.round(base * 0.02) || 4));
    slider.min = String(min);
    slider.max = String(base);
    slider.value = String(info.currentTriangles);
    numberInput.min = String(min);
    numberInput.max = String(base);
    numberInput.value = String(info.currentTriangles);
  } else {
    const max = base * 8;
    const defaultTarget = base * 2;
    slider.min = String(base);
    slider.max = String(max);
    slider.value = String(defaultTarget);
    numberInput.min = String(base);
    numberInput.removeAttribute('max');
    numberInput.value = String(defaultTarget);
  }

  // Edge-length / size knob: a length slider in mesh units (+ amount for size).
  if (lengthSlider && lengthInput) {
    const { lo, hi, def } = lengthBounds();
    const step = Math.max((hi - lo) / 200, 1e-6);
    lengthSlider.min = String(lo);
    lengthSlider.max = String(hi);
    lengthSlider.step = String(step);
    lengthSlider.value = String(def);
    lengthInput.min = String(fmtLen(lo));
    lengthInput.step = String(fmtLen(step) || step);
    lengthInput.removeAttribute('max'); // user may type beyond the slider range
    lengthInput.value = String(fmtLen(def));
  }
  if (lengthLabel) lengthLabel.textContent = lengthLabelText();
}

/** Label for the length/threshold input, per mode + knob. */
function lengthLabelText(): string {
  if (knobMode === 'size') {
    return mode === 'simplify' ? 'Min feature size (remove smaller)' : 'Refine triangles larger than';
  }
  return mode === 'simplify' ? 'Tolerance (feature size)' : 'Target edge length';
}

/** The length/threshold value typed into the length knob (mesh units). */
function lengthVal(): number {
  const n = Number(lengthInput?.value);
  if (Number.isFinite(n) && n > 0) return n;
  const s = Number(lengthSlider?.value);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** The integer "amount" (strength / detail levels) for the size knob. */
function amountVal(): number {
  const a = Math.round(Number(amountSlider?.value));
  return Number.isFinite(a) && a >= 1 ? a : 1;
}

interface MeshOpRequest {
  kind: 'count' | 'simplifyTol' | 'enhanceLen' | 'noop';
  /** Target triangle count (count), tolerance (simplifyTol), or edge length
   *  (enhanceLen). */
  value: number;
}

/** Translate the current mode + knob + control values into the operation to
 *  run. Size-knob math: simplify scales the tolerance up by the amount
 *  (stronger), enhance divides the target edge length by 2^(amount-1) (more
 *  detail levels on the over-threshold triangles). */
function currentRequest(): MeshOpRequest {
  if (!info) return { kind: 'noop', value: 0 };
  if (knobMode === 'count') return { kind: 'count', value: currentTarget() };
  const L = lengthVal();
  if (!(L > 0)) return { kind: 'noop', value: 0 };
  if (mode === 'simplify') {
    return { kind: 'simplifyTol', value: knobMode === 'size' ? L * amountVal() : L };
  }
  return { kind: 'enhanceLen', value: knobMode === 'size' ? L / Math.pow(2, amountVal() - 1) : L };
}

function requestKey(r: MeshOpRequest): string {
  // Full precision: the number input accepts arbitrary precision, so quantizing
  // here could mask a genuine change and leave Apply stuck disabled. The value
  // is computed deterministically from the same inputs, so equal requests
  // produce equal floats.
  return `${knobMode}:${r.kind}:${r.value > 0 ? String(r.value) : '0'}`;
}

function closePanel(): void {
  revertQualityPreview();
  panel?.classList.add('hidden');
  document.removeEventListener('keydown', onSimplifyEscape);
  closeViewportPanel(registryEntry);
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
  return clampTarget(Number(numberInput?.value ?? slider?.value ?? info?.currentTriangles ?? 0));
}

function updateApplyEnabled(): void {
  if (!applyBtn) return;
  const r = currentRequest();
  applyBtn.disabled = applying || !info || r.kind === 'noop' || requestKey(r) === appliedKey;
}

function updateSaveEnabled(): void {
  if (!saveBtn) return;
  saveBtn.disabled = applying || !info || appliedCount === info.baseTriangles;
}

function setControlsDisabled(disabled: boolean): void {
  if (slider) slider.disabled = disabled;
  if (numberInput) numberInput.disabled = disabled;
  if (lengthSlider) lengthSlider.disabled = disabled;
  if (lengthInput) lengthInput.disabled = disabled;
  if (amountSlider) amountSlider.disabled = disabled;
  if (resetBtn) resetBtn.disabled = disabled;
  if (simplifyModeBtn) simplifyModeBtn.disabled = disabled;
  if (enhanceModeBtn) enhanceModeBtn.disabled = disabled;
  if (knobCountBtn) knobCountBtn.disabled = disabled;
  if (knobEdgeBtn) knobEdgeBtn.disabled = disabled;
  if (knobSizeBtn) knobSizeBtn.disabled = disabled;
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
  const req = currentRequest();
  if (req.kind === 'noop' || requestKey(req) === appliedKey) return;
  const baseline = info;
  const currentMode = mode;
  const isDirect = req.kind !== 'count';
  const doPreserveColor = preserveColor && info.hasColor;

  applying = true;
  applyAbort = new AbortController();
  const abort = applyAbort;
  setControlsDisabled(true);
  if (statusEl) statusEl.textContent = '';

  const title = currentMode === 'simplify' ? 'Simplifying mesh' : 'Enhancing mesh';
  // The count knob binary-searches; the direct knobs run a single pass.
  const searchMsg = isDirect
    ? (currentMode === 'simplify' ? 'Simplifying mesh…' : 'Enhancing mesh…')
    : (currentMode === 'simplify' ? 'Searching for the gentlest tolerance…' : 'Searching for the finest edge length…');

  const progressId = startProgress({
    title,
    message: searchMsg,
    onCancel: () => abort.abort(),
  });

  const onProgress = (fraction: number): void => {
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    updateProgress(progressId, fraction, `${currentMode === 'simplify' ? 'Simplifying' : 'Enhancing'}… ${pct}%`);
  };

  try {
    let r: { triangleCount: number } | null;
    if (req.kind === 'count') {
      const handler = currentMode === 'simplify' ? handlers.apply : handlers.enhance;
      r = await handler.call(handlers, req.value, doPreserveColor, onProgress, abort.signal);
    } else if (req.kind === 'simplifyTol') {
      r = await handlers.simplifyByTolerance(req.value, doPreserveColor, onProgress, abort.signal);
    } else {
      r = await handlers.enhanceByEdgeLength(req.value, doPreserveColor, onProgress, abort.signal);
    }
    appliedKey = requestKey(req);
    showResult(r ? r.triangleCount : baseline.baseTriangles);
    if (!r && isDirect) {
      // A direct pass that changed nothing means the threshold matched no
      // edges / triangles — warn so the user knows to adjust the knob.
      const warn = currentMode === 'simplify'
        ? 'Nothing to simplify at that setting — no detail was below the tolerance. Try a larger value.'
        : 'Nothing to enhance at that setting — no edge was longer than that. Try a smaller value.';
      if (statusEl) statusEl.textContent = warn;
      showToast(warn, { variant: 'warn', source: 'engine' });
    } else if (statusEl) {
      statusEl.textContent = '';
    }
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
  p.className = 'hidden absolute z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg shadow-xl';
  p.style.minWidth = '240px';
  p.style.maxWidth = '280px';

  // Header: drag handle + title + × close button.
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between px-2.5 py-2 border-b border-zinc-700/70';
  panelHeader = header;
  const titleEl = document.createElement('div');
  titleEl.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  titleEl.textContent = 'Quality';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 transition-colors leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700/60';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close quality panel');
  closeBtn.addEventListener('click', closePanel);
  header.append(titleEl, closeBtn);
  p.appendChild(header);

  // Padded content area beneath the header.
  const c = document.createElement('div');
  c.className = 'p-2.5';
  p.appendChild(c);

  // --- Curvature quality section ---
  const qualitySection = document.createElement('div');
  qualitySection.className = 'mb-2';

  const qualityLabel = document.createElement('div');
  qualityLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  qualityLabel.textContent = 'Curvature Quality';
  qualitySection.appendChild(qualityLabel);

  const radiosWrap = document.createElement('div');
  radiosWrap.className = 'flex flex-col gap-0.5';
  qualityRadios = [];

  for (const opt of QUALITY_OPTIONS) {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-1.5 py-0.5 cursor-pointer rounded hover:bg-zinc-700/30 transition-colors';
    row.title = opt.hint;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'curvature-quality';
    radio.value = opt.id;
    radio.className = 'accent-blue-400 cursor-pointer flex-shrink-0';
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      // Live preview only — re-render at the new quality but don't commit it.
      // Apply quality persists it; closing the panel reverts it.
      onCancelRender?.();
      const { customSegments } = loadQualitySettings();
      saveQualityForLang({ quality: opt.id, customSegments });
      updateQualityApplyEnabled();
    });
    qualityRadios.push(radio);

    const labelEl = document.createElement('span');
    labelEl.className = 'text-xs text-zinc-200 flex-1';
    labelEl.textContent = opt.label;

    const segsEl = document.createElement('span');
    segsEl.className = 'text-[10px] text-zinc-500 tabular-nums';
    segsEl.textContent = `${QUALITY_SEGMENTS[opt.id]}`;

    row.append(radio, labelEl, segsEl);
    radiosWrap.appendChild(row);
  }
  qualitySection.appendChild(radiosWrap);
  syncQualityRadios();

  qualityApplyBtn = document.createElement('button');
  qualityApplyBtn.id = 'quality-apply';
  qualityApplyBtn.className = 'w-full mt-2 px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
  qualityApplyBtn.textContent = 'Apply quality';
  qualityApplyBtn.title = 'Commit the previewed curvature quality. Closing the panel without applying reverts it.';
  qualityApplyBtn.disabled = true;
  qualityApplyBtn.addEventListener('click', applyQualityPreview);
  qualitySection.appendChild(qualityApplyBtn);

  stopRenderBtn = document.createElement('button');
  stopRenderBtn.className = 'hidden w-full mt-2 px-2 py-1 rounded text-xs bg-red-500/20 text-red-300 [@media(hover:hover)]:hover:bg-red-500/30 transition-colors border border-red-500/40';
  stopRenderBtn.textContent = '■ Stop rendering';
  stopRenderBtn.title = 'Cancel the current OpenSCAD render';
  stopRenderBtn.addEventListener('click', () => { onCancelRender?.(); });
  qualitySection.appendChild(stopRenderBtn);

  c.appendChild(qualitySection);

  // Divider between quality and simplify sections
  const divider = document.createElement('div');
  divider.className = 'border-t border-zinc-600/40 my-2';
  c.appendChild(divider);

  const simplifySubHeader = document.createElement('div');
  simplifySubHeader.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-medium';
  simplifySubHeader.textContent = 'Simplify / Enhance';
  c.appendChild(simplifySubHeader);

  originalEl = document.createElement('div');
  originalEl.id = 'simplify-original';
  originalEl.className = 'text-xs text-zinc-300 mb-2';
  originalEl.textContent = 'Original: —';
  c.appendChild(originalEl);

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
  c.appendChild(modeRow);

  // Controls wrapper (hidden when no model is available)
  controlsEl = document.createElement('div');

  // Knob-mode pills: Count | Edge length | Size. Each picks how the target is
  // expressed; syncModeUI shows the matching control group.
  const makeKnobBtn = (text: string, km: KnobMode, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.id = `simplify-knob-${km}`;
    b.textContent = text;
    b.title = title;
    b.className = km === knobMode ? MODE_ACTIVE : MODE_INACTIVE;
    b.addEventListener('click', () => {
      if (applying || knobMode === km) return;
      knobMode = km;
      if (info) syncModeUI();
      updateApplyEnabled();
    });
    return b;
  };
  const knobRow = document.createElement('div');
  knobRow.className = 'flex gap-1 mb-2';
  knobCountBtn = makeKnobBtn('Count', 'count', 'Target a triangle count');
  knobEdgeBtn = makeKnobBtn('Edge', 'edge', 'Target an edge length (mesh units) — affects the larger triangles first');
  knobSizeBtn = makeKnobBtn('Size', 'size', 'Target a triangle-size threshold with a strength amount');
  knobRow.append(knobCountBtn, knobEdgeBtn, knobSizeBtn);
  controlsEl.appendChild(knobRow);

  // --- Count knob: target triangle count ---
  countControls = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Target triangles';
  label.htmlFor = 'simplify-input';
  countControls.appendChild(label);

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
  countControls.appendChild(row);
  controlsEl.appendChild(countControls);

  // --- Edge length / Size knob: a length in mesh units (+ amount for Size) ---
  lengthControls = document.createElement('div');
  lengthControls.classList.add('hidden');

  lengthLabel = document.createElement('label');
  lengthLabel.className = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  lengthLabel.htmlFor = 'simplify-length-input';
  lengthLabel.textContent = 'Target edge length';
  lengthControls.appendChild(lengthLabel);

  const lengthRow = document.createElement('div');
  lengthRow.className = 'flex items-center gap-2 mb-2';

  lengthSlider = document.createElement('input');
  lengthSlider.type = 'range';
  lengthSlider.id = 'simplify-length-slider';
  lengthSlider.className = 'flex-1 accent-blue-400 cursor-pointer';
  lengthSlider.addEventListener('input', () => {
    if (applying) return;
    if (lengthInput) lengthInput.value = String(fmtLen(Number(lengthSlider!.value)));
    updateApplyEnabled();
  });
  lengthRow.appendChild(lengthSlider);

  lengthInput = document.createElement('input');
  lengthInput.type = 'number';
  lengthInput.id = 'simplify-length-input';
  lengthInput.className = 'w-20 px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';
  lengthInput.min = '0';
  const syncLengthFromInput = (): void => {
    if (applying) return;
    const v = Number(lengthInput!.value);
    if (lengthSlider && Number.isFinite(v) && v > 0) {
      lengthSlider.value = String(Math.max(Number(lengthSlider.min), Math.min(Number(lengthSlider.max), v)));
    }
    updateApplyEnabled();
  };
  lengthInput.addEventListener('input', syncLengthFromInput);
  lengthInput.addEventListener('change', syncLengthFromInput);
  lengthRow.appendChild(lengthInput);
  lengthControls.appendChild(lengthRow);

  // Amount (size knob only): strength for simplify / detail levels for enhance.
  amountRow = document.createElement('div');
  amountRow.className = 'flex items-center gap-2 mb-2';
  amountRow.classList.add('hidden');
  const amountLabel = document.createElement('span');
  amountLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  amountLabel.textContent = 'Amount';
  amountSlider = document.createElement('input');
  amountSlider.type = 'range';
  amountSlider.id = 'simplify-amount-slider';
  amountSlider.className = 'flex-1 accent-blue-400 cursor-pointer';
  amountSlider.min = '1';
  amountSlider.max = '6';
  amountSlider.step = '1';
  amountSlider.value = '2';
  amountValueEl = document.createElement('span');
  amountValueEl.className = 'text-xs text-zinc-300 tabular-nums w-6 text-right';
  amountValueEl.textContent = '2';
  amountSlider.addEventListener('input', () => {
    if (applying) return;
    if (amountValueEl) amountValueEl.textContent = String(amountVal());
    updateApplyEnabled();
  });
  amountRow.append(amountLabel, amountSlider, amountValueEl);
  lengthControls.appendChild(amountRow);
  controlsEl.appendChild(lengthControls);

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
    // Re-read the (now restored) baseline so every control returns to its
    // default and Apply goes idle until the user changes something.
    refresh(false);
    if (statusEl) statusEl.textContent = '';
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

  c.appendChild(controlsEl);

  statusEl = document.createElement('div');
  statusEl.id = 'simplify-status';
  statusEl.className = 'text-xs text-zinc-400 mt-2';
  c.appendChild(statusEl);

  return p;
}
