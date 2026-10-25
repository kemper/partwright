// Resize/scale modal — a right-aligned, draggable panel that lets the user
// scale the current model along X, Y, and Z independently or uniformly.
// Uses the same bake-to-mesh strategy as the surface modifiers: Apply saves
// a new version with the scaled geometry on api.imports[0], so undo is just
// the version history. No code locking — the original parametric code is
// untouched; the scaled result is its own version.

import { registerCommands } from './commandPalette';
import { getConfig } from '../config/appConfig';
import { getBuildVolume } from '../geometry/printerSettings';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';
import { TOOL_PANEL_CLASS, TOOL_PANEL_HEADER, TOOL_PANEL_TITLE, TOOL_PANEL_CLOSE } from './toolPanel';
import { createSliderEntry } from './sliderEntry';
import { registerTool, createToolNote, type PrefillSchema, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';

type ApplyResult = { error?: string; label?: string } | Record<string, unknown>;

type BBox = { x?: number[]; y?: number[]; z?: number[]; min?: number[]; max?: number[] } | null;

export interface ResizeApi {
  scaleModel(sx: number, sy: number, sz: number, opts?: { mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }): Promise<ApplyResult>;
  previewScale(sx: number, sy: number, sz: number, opts?: { preserveColor?: boolean }): { ok: true } | { error: string };
  clearScalePreview(): { ok: true };
  getGeometryData(): { boundingBox?: BBox } | Record<string, unknown>;
  canPlaceParametric(): boolean;
  modelHasColor(): boolean;
}

type ScaleMode = 'percent' | 'units';

let openModal: HTMLDivElement | null = null;
let currentResizeClose: (() => void) | null = null;
let currentResizeState: (() => Record<string, unknown>) | null = null;

/** Prefill keys for `openTool('tool-resize', …)`. */
const RESIZE_PREFILL_SCHEMA: PrefillSchema = {
  scale: { type: 'numberOrVec3', min: 0.01, description: 'Scale factor: a number (uniform) or [sx, sy, sz]. 1 = no change.' },
  size: { type: 'vec3', description: 'Target size [x, y, z] in model units (switches to raw units).' },
  uniform: { type: 'boolean', description: 'Link the axes (default true).' },
  fitToBed: { type: 'boolean', description: 'Stage a uniform fit to the printer build volume.' },
  mode: { type: 'enum', values: ['parametric', 'bake'], description: 'Write-back: keep editable code (manifold-js) or bake to a mesh.' },
  preserveColor: { type: 'boolean', description: 'Keep paint on bake (painted models only).' },
};

interface ResizeOpenOpts {
  fitToBed?: boolean;
  prefill?: Record<string, unknown>;
  note?: string;
  source?: ToolOpenContext['source'];
}

const resizeRegistryEntry = { close(): void { currentResizeClose?.(); } };

function onResizeEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  currentResizeClose?.();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function getBbox(api: ResizeApi): { size: [number, number, number]; min: [number, number, number]; max: [number, number, number] } | null {
  try {
    const gd = api.getGeometryData() as { boundingBox?: BBox };
    const bb = gd?.boundingBox;
    if (!bb) return null;
    // The geometry-data payload encodes the box as per-axis [min, max] pairs
    // (x/y/z); accept the legacy {min, max} vector form as a fallback.
    let mn: number[] | undefined;
    let mx: number[] | undefined;
    if (bb.x && bb.y && bb.z) {
      mn = [bb.x[0], bb.y[0], bb.z[0]];
      mx = [bb.x[1], bb.y[1], bb.z[1]];
    } else if (bb.min && bb.max) {
      mn = bb.min;
      mx = bb.max;
    }
    if (mn && mx) {
      return {
        min: [mn[0], mn[1], mn[2]],
        max: [mx[0], mx[1], mx[2]],
        size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
      };
    }
  } catch { /* fall through */ }
  return null;
}

/** Find the viewport container used by the other overlay panels. */
function getViewportContainer(): HTMLElement {
  return (document.getElementById('clip-controls')?.offsetParent as HTMLElement | null) ?? document.body;
}

/** The uniform scale factor that makes a model of the given size touch — but not
 *  exceed — the printer build volume on its most-constraining axis. Returns null
 *  when the model has no measurable size. */
function fitToBedFactor(size: [number, number, number], bed: [number, number, number]): number | null {
  let f = Infinity;
  for (let i = 0; i < 3; i++) {
    if (size[i] > 1e-9) f = Math.min(f, bed[i] / size[i]);
  }
  return Number.isFinite(f) && f > 0 ? f : null;
}

export function openResizeModal(api: ResizeApi, opts?: ResizeOpenOpts): ToolOpenResult {
  const bbox = getBbox(api);
  const size = bbox?.size ?? [10, 10, 10];

  // Validate the prefill up front (before touching any open panel).
  const p = opts?.prefill ?? {};
  const ignored: string[] = [];
  {
    const errors: string[] = [];
    if (p.scale !== undefined && p.size !== undefined) errors.push('pass scale OR size, not both');
    if (p.fitToBed && (p.scale !== undefined || p.size !== undefined)) errors.push('fitToBed computes the scale — drop scale/size');
    if (Array.isArray(p.size) && (p.size as number[]).some(n => !(n > 0.001))) errors.push('size values must be > 0.001');
    const perAxis = Array.isArray(p.scale) || Array.isArray(p.size);
    if (p.uniform === true && perAxis) {
      const v = (Array.isArray(p.scale) ? p.scale : (p.size as number[]).map((n, i) => n / (size[i] || 1))) as number[];
      if (Math.max(...v) - Math.min(...v) > 1e-9) errors.push('uniform:true needs the same factor on every axis');
    }
    if (p.mode === 'parametric' && !api.canPlaceParametric()) errors.push("mode 'parametric' isn't available for this model (needs an unpainted manifold-js model) — use 'bake'");
    if (errors.length) return { error: errors.join('; ') };
  }
  if (openModal) { openModal.remove(); openModal = null; currentResizeClose = null; }

  // State
  let mode: ScaleMode = 'percent';
  let uniform = true;
  // Percent values (100 = no change)
  let pctX = 100, pctY = 100, pctZ = 100;
  // Raw unit values (initialized to current size)
  let rawX = size[0], rawY = size[1], rawZ = size[2];
  // Max values for sliders (user-configurable)
  let maxPct = 500;
  let maxRaw = Math.max(...size) * 5 || 100;

  let preserveColor = true;
  const hasColor = api.modelHasColor();
  const canParametric = api.canPlaceParametric();
  // Write-back: keep a manifold-js model editable (wrap the source in .scale)
  // or bake the scaled mesh. Defaults to parametric when available.
  let writeBack: 'parametric' | 'bake' = canParametric ? 'parametric' : 'bake';
  let colorRow: HTMLElement | null = null;
  // Preserve-colors only applies to the bake path; parametric re-runs the code.
  const syncColorRow = () => { if (colorRow) colorRow.style.display = writeBack === 'bake' ? '' : 'none'; };

  let previewDirty = false;
  let previewTimer: number | undefined;

  const container = getViewportContainer();

  // Absolutely positioned inside the viewport container, below the toolbar.
  const panel = el('div', `${TOOL_PANEL_CLASS} text-zinc-100 w-[min(94vw,360px)] max-h-[calc(100%-3.5rem)] select-none`);

  // Header — drag handle + title + × button (shared tool-panel chrome).
  const header = el('div', TOOL_PANEL_HEADER);
  header.append(el('h2', TOOL_PANEL_TITLE, 'Resize model'));
  const closeBtn = el('button', TOOL_PANEL_CLOSE, '×');
  closeBtn.setAttribute('aria-label', 'Close resize panel');
  header.append(closeBtn);
  panel.append(header);
  const dragHandle = attachViewportPanelDrag(header, panel);

  const body = el('div', 'p-4 overflow-y-auto flex-1');
  panel.append(body);

  const status = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mt-1');

  // ---- Fit to print bed ----
  // Scales uniformly so the model fits within the configured build volume. The
  // factor is staged into the percent controls and previewed; Apply commits it,
  // so the user always sees the result before it's saved.
  const bed = getBuildVolume();
  const fitRow = el('div', 'mb-4');
  const fitBtn = el('button', 'w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs flex items-center gap-2');
  fitBtn.innerHTML = `<span aria-hidden="true">▣</span><span>Fit to print bed <span class="text-zinc-500">(${bed[0]}×${bed[1]}×${bed[2]})</span></span>`;
  fitBtn.title = 'Scale uniformly so the model fits within the printer build volume';
  fitRow.append(fitBtn);
  body.append(fitRow);

  function applyFit() {
    const factor = fitToBedFactor(size as [number, number, number], bed);
    if (factor === null) { status.textContent = 'Cannot fit: model has no measurable size.'; return; }
    mode = 'percent';
    uniform = true;
    uniformCheck.checked = true;
    pctX = pctY = pctZ = factor * 100;
    rawX = size[0] * factor; rawY = size[1] * factor; rawZ = size[2] * factor;
    syncModeBtns();
    renderControls();
    schedulePreview();
    status.textContent = `Fit to bed: ${(factor * 100).toFixed(1)}% → ${(size[0] * factor).toFixed(1)} × ${(size[1] * factor).toFixed(1)} × ${(size[2] * factor).toFixed(1)}. Apply to save.`;
  }
  fitBtn.addEventListener('click', applyFit);

  // ---- Mode toggle (% / units) ----
  const modeRow = el('div', 'flex items-center gap-2 mb-4');
  modeRow.append(el('span', 'text-xs text-zinc-400', 'Scale by'));
  const btnPct = el('button', '', '%');
  const btnUnits = el('button', '', 'Raw units');
  const ACTIVE_TAB = 'px-2.5 py-1 rounded text-xs bg-blue-600 text-white';
  const IDLE_TAB = 'px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
  function syncModeBtns() {
    btnPct.className = mode === 'percent' ? ACTIVE_TAB : IDLE_TAB;
    btnUnits.className = mode === 'units' ? ACTIVE_TAB : IDLE_TAB;
  }
  btnPct.addEventListener('click', () => { mode = 'percent'; syncModeBtns(); renderControls(); });
  btnUnits.addEventListener('click', () => { mode = 'units'; syncModeBtns(); renderControls(); });
  modeRow.append(btnPct, btnUnits);
  body.append(modeRow);
  syncModeBtns();

  // ---- Uniform toggle ----
  const uniformRow = el('label', 'flex items-center gap-2 mb-4 text-xs text-zinc-300 cursor-pointer');
  const uniformCheck = el('input', 'accent-blue-500');
  uniformCheck.type = 'checkbox';
  uniformCheck.checked = uniform;
  uniformCheck.addEventListener('change', () => {
    uniform = uniformCheck.checked;
    if (uniform) {
      // Snap Y and Z to X when locking
      pctY = pctX; pctZ = pctX;
      rawY = rawX; rawZ = rawX;
    }
    renderControls();
  });
  uniformRow.append(uniformCheck, el('span', '', 'Uniform scaling (XYZ linked)'));
  body.append(uniformRow);

  // ---- Max value row ----
  const maxRow = el('div', 'flex items-center gap-2 mb-3 text-xs text-zinc-400');
  maxRow.append(el('span', '', 'Slider max:'));
  const maxInput = el('input', 'w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-200 focus:border-blue-400 focus:outline-none');
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.step = '1';
  const maxUnit = el('span', 'text-zinc-500', '');
  function syncMaxInput() {
    if (mode === 'percent') {
      maxInput.value = String(maxPct);
      maxUnit.textContent = '%';
    } else {
      maxInput.value = String(maxRaw.toFixed(2));
      maxUnit.textContent = 'units';
    }
  }
  maxInput.addEventListener('change', () => {
    const v = parseFloat(maxInput.value);
    if (!Number.isFinite(v) || v < 1) return;
    if (mode === 'percent') maxPct = v;
    else maxRaw = v;
    renderControls();
  });
  maxRow.append(maxInput, maxUnit);
  body.append(maxRow);

  // ---- Axis controls container ----
  const axisContainer = el('div', 'space-y-3 mb-4');
  body.append(axisContainer);

  // ---- Write-back mode ----
  const modeWrap = el('div', 'flex flex-col gap-1.5 mb-3 pt-1 border-t border-zinc-800');
  modeWrap.append(el('div', 'text-[11px] text-zinc-400 font-medium pt-2', 'Write-back'));
  if (canParametric) {
    const mkRadio = (value: 'parametric' | 'bake', label: string, hint: string): HTMLElement => {
      const row = el('label', 'flex items-start gap-2 text-xs text-zinc-300 cursor-pointer');
      const radio = el('input', 'accent-blue-500 mt-0.5');
      radio.type = 'radio';
      radio.name = 'resize-writeback';
      radio.value = value;
      radio.checked = writeBack === value;
      radio.addEventListener('change', () => { if (radio.checked) { writeBack = value; syncColorRow(); } });
      const txt = el('span', '');
      txt.append(el('span', 'text-zinc-200', label));
      txt.append(el('span', 'block text-[10px] text-zinc-500', hint));
      row.append(radio, txt);
      return row;
    };
    modeWrap.append(
      mkRadio('parametric', 'Keep editable code', 'Wraps your model code in .scale(...) — stays parametric.'),
      mkRadio('bake', 'Bake to mesh', 'Flattens the scaled model to a fixed mesh.'),
    );
  } else {
    modeWrap.append(el('p', 'text-[11px] text-zinc-500 leading-snug',
      hasColor
        ? 'This model has manual paint, so the result is baked to a mesh (keeps the paint).'
        : 'Baked to a mesh (editable-code scaling needs a manifold-js model).'));
  }
  body.append(modeWrap);

  // ---- Preserve colors checkbox (only when the model has paint) ----
  if (hasColor) {
    colorRow = el('label', 'flex items-center gap-2 mb-3 text-xs text-zinc-300 cursor-pointer');
    const colorCheck = el('input', 'accent-blue-500');
    colorCheck.type = 'checkbox';
    colorCheck.checked = preserveColor;
    colorCheck.addEventListener('change', () => {
      preserveColor = colorCheck.checked;
      schedulePreview();
    });
    colorRow.append(colorCheck, el('span', '', 'Preserve colors (best-effort)'));
    body.append(colorRow);
    syncColorRow();
  }

  // ---- Current size display ----
  const sizeInfo = el('div', 'text-[11px] text-zinc-500 mb-3');
  if (bbox) {
    sizeInfo.textContent = `Current size: ${size[0].toFixed(2)} × ${size[1].toFixed(2)} × ${size[2].toFixed(2)} units`;
  }
  body.append(sizeInfo);

  body.append(status);

  // Footer
  const footer = el('div', 'flex justify-end gap-2 px-4 pb-4 shrink-0');
  const resetBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs', 'Reset');
  const cancelBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs', 'Cancel');
  const applyBtn = el('button', 'px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium', 'Apply');
  footer.append(resetBtn, cancelBtn, applyBtn);
  panel.append(footer);

  // ---- Axis slider builder ----
  function buildAxisControl(axis: 'X' | 'Y' | 'Z'): HTMLElement {
    const wrap = el('div', 'text-xs text-zinc-300');
    const labelRow = el('div', 'flex justify-between mb-1');
    const label = el('span', 'font-mono font-semibold text-zinc-200', axis);
    const readout = el('span', 'text-zinc-400 tabular-nums', '');
    labelRow.append(label, readout);

    function getValue() {
      if (mode === 'percent') return axis === 'X' ? pctX : axis === 'Y' ? pctY : pctZ;
      return axis === 'X' ? rawX : axis === 'Y' ? rawY : rawZ;
    }
    function getMax() { return mode === 'percent' ? maxPct : maxRaw; }
    const fmt = (v: number) => (mode === 'percent' ? v.toFixed(1) : v.toFixed(3));
    const showReadout = (v: number) => { readout.textContent = mode === 'percent' ? `${fmt(v)}%` : fmt(v); };

    // The slider spans [min, "Slider max"]; the box takes any larger value and
    // grows the range to fit it (and the "Slider max" box with it) instead of
    // silently clamping it.
    const entry = createSliderEntry({
      label: `${axis} scale`,
      min: mode === 'percent' ? 1 : 0.001,
      max: getMax(),
      step: mode === 'percent' ? 0.1 : 0.001,
      value: getValue(),
      hardMax: Infinity,
      format: fmt,
      onChange: (v) => {
        const grow = v > getMax();
        if (grow) { if (mode === 'percent') maxPct = v; else maxRaw = v; }
        if (mode === 'percent') {
          if (axis === 'X' || uniform) pctX = v;
          if (axis === 'Y' || uniform) pctY = v;
          if (axis === 'Z' || uniform) pctZ = v;
        } else {
          if (axis === 'X' || uniform) rawX = v;
          if (axis === 'Y' || uniform) rawY = v;
          if (axis === 'Z' || uniform) rawZ = v;
        }
        // A grown range applies to every axis' slider and the max box.
        if (grow) renderControls();
        else showReadout(v);
        schedulePreview();
      },
      rangeClass: 'flex-1 accent-blue-500',
      inputClass: 'w-20 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 text-right text-zinc-200 font-mono focus:border-blue-400 focus:outline-none text-xs',
    });
    const controlRow = el('div', 'flex items-center gap-2');
    controlRow.append(entry.range, entry.input);
    wrap.append(labelRow, controlRow);
    showReadout(getValue());
    return wrap;
  }

  function renderControls() {
    syncMaxInput();
    axisContainer.innerHTML = '';
    const axes: ('X' | 'Y' | 'Z')[] = uniform ? ['X'] : ['X', 'Y', 'Z'];
    for (const axis of axes) {
      axisContainer.append(buildAxisControl(axis));
    }
    if (uniform) {
      axisContainer.append(el('p', 'text-[11px] text-zinc-500 mt-1', 'All axes scale together. Uncheck "Uniform scaling" for independent control.'));
    }
  }

  function getScaleFactors(): [number, number, number] {
    if (mode === 'percent') {
      return [pctX / 100, pctY / 100, pctZ / 100];
    }
    // raw units: factor = target / current
    const sx = size[0] > 0 ? rawX / size[0] : 1;
    const sy = size[1] > 0 ? rawY / size[1] : 1;
    const sz = size[2] > 0 ? rawZ / size[2] : 1;
    return [sx, sy, sz];
  }

  function schedulePreview() {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    status.textContent = 'Updating preview…';
    previewTimer = window.setTimeout(() => {
      const [sx, sy, sz] = getScaleFactors();
      // Identity scale: revert any preview already pushed (e.g. the user dialed
      // every axis back to 100%/current size) instead of leaving the stale
      // scaled mesh in the viewport.
      if (Math.abs(sx - 1) < 0.0001 && Math.abs(sy - 1) < 0.0001 && Math.abs(sz - 1) < 0.0001) {
        clearPreview();
        return;
      }
      const r = api.previewScale(sx, sy, sz, { preserveColor });
      if ((r as { error?: string }).error) {
        status.textContent = `Preview error: ${(r as { error: string }).error}`;
      } else {
        previewDirty = true;
        status.textContent = 'Previewing — Apply to save a new version.';
      }
    }, getConfig().ui.surfacePreviewDebounceMs);
  }

  function clearPreview() {
    if (previewTimer !== undefined) { clearTimeout(previewTimer); previewTimer = undefined; }
    if (previewDirty) { api.clearScalePreview(); previewDirty = false; }
    status.textContent = '';
  }

  const close = () => {
    clearPreview();
    dragHandle.destroy();
    panel.remove();
    openModal = null;
    currentResizeClose = null;
    currentResizeState = null;
    closeViewportPanel(resizeRegistryEntry);
    document.removeEventListener('keydown', onResizeEscape);
  };

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  resetBtn.addEventListener('click', () => {
    pctX = pctY = pctZ = 100;
    rawX = size[0]; rawY = size[1]; rawZ = size[2];
    renderControls();
    clearPreview();
  });

  applyBtn.addEventListener('click', async () => {
    clearPreview();
    applyBtn.disabled = true;
    const prev = applyBtn.textContent;
    applyBtn.textContent = 'Applying…';
    status.textContent = 'Working…';
    try {
      const [sx, sy, sz] = getScaleFactors();
      const result = await api.scaleModel(sx, sy, sz, { mode: writeBack, preserveColor });
      const err = (result as { error?: string })?.error;
      if (err) {
        status.textContent = `Error: ${err}`;
        applyBtn.disabled = false;
        applyBtn.textContent = prev ?? 'Apply';
        return;
      }
      close();
    } catch (e) {
      status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      applyBtn.disabled = false;
      applyBtn.textContent = prev ?? 'Apply';
    }
  });

  if (opts?.note) {
    const note = createToolNote(opts.note, opts.source);
    note.classList.add('mb-3');
    body.prepend(note);
  }

  renderControls();
  container.append(panel);
  setInitialPanelPosition(panel);
  currentResizeClose = close;
  currentResizeState = () => {
    const f = getScaleFactors();
    return {
      scale: f,
      size: [size[0] * f[0], size[1] * f[1], size[2] * f[2]],
      uniform,
      input: mode,
      mode: writeBack,
      preserveColor,
    };
  };
  openViewportPanel(resizeRegistryEntry);
  document.addEventListener('keydown', onResizeEscape);
  openModal = panel as HTMLDivElement;

  // Opened from the "fit to print bed" command: stage the fit immediately so the
  // user lands on a previewed result, one Apply away from saving.
  const applied: Record<string, unknown> = {};
  if (opts?.fitToBed || p.fitToBed) { applyFit(); if (p.fitToBed) applied.fitToBed = true; }

  // Prefill (validated above): stage the values and preview — never Apply.
  if (p.mode !== undefined) {
    writeBack = p.mode as 'parametric' | 'bake';
    for (const r of panel.querySelectorAll<HTMLInputElement>('input[name="resize-writeback"]')) r.checked = r.value === writeBack;
    syncColorRow();
    applied.mode = writeBack;
  }
  if (p.preserveColor !== undefined) {
    if (hasColor) {
      preserveColor = p.preserveColor as boolean;
      const cb = colorRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (cb) cb.checked = preserveColor;
      applied.preserveColor = preserveColor;
    } else ignored.push('preserveColor');
  }
  if (p.scale !== undefined || p.size !== undefined) {
    if (p.scale !== undefined) {
      const s = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : (p.scale as number[]);
      mode = 'percent';
      uniform = p.uniform !== undefined ? (p.uniform as boolean) : s[0] === s[1] && s[1] === s[2];
      [pctX, pctY, pctZ] = [s[0] * 100, s[1] * 100, s[2] * 100];
      [rawX, rawY, rawZ] = [size[0] * s[0], size[1] * s[1], size[2] * s[2]];
      maxPct = Math.max(maxPct, pctX, pctY, pctZ);
      applied.scale = p.scale;
    } else {
      const s = p.size as number[];
      mode = 'units';
      const f = s.map((n, i) => n / (size[i] || 1));
      uniform = p.uniform !== undefined ? (p.uniform as boolean) : Math.max(...f) - Math.min(...f) < 1e-9;
      [rawX, rawY, rawZ] = [s[0], s[1], s[2]];
      [pctX, pctY, pctZ] = [f[0] * 100, f[1] * 100, f[2] * 100];
      maxRaw = Math.max(maxRaw, rawX, rawY, rawZ);
      applied.size = s;
    }
    uniformCheck.checked = uniform;
    applied.uniform = uniform;
    syncModeBtns();
    renderControls();
    schedulePreview();
  } else if (p.uniform !== undefined) {
    uniform = p.uniform as boolean;
    uniformCheck.checked = uniform;
    if (uniform) { pctY = pctZ = pctX; rawY = rawZ = rawX; }
    renderControls();
    applied.uniform = uniform;
  }
  return { applied, ignored };
}

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

export function initResizeUI(api: ResizeApi): void {
  registerTool({
    id: 'tool-resize',
    title: 'Resize / scale model',
    hint: 'Tools',
    prefillSchema: RESIZE_PREFILL_SCHEMA,
    open: (prefill, ctx) => openResizeModal(api, { prefill, note: ctx.note, source: ctx.source }),
    getState: () => currentResizeState?.() ?? null,
    isOpen: () => openModal !== null,
    close: () => currentResizeClose?.(),
  });
  registerCommands([
    {
      id: 'resize-model',
      title: 'Resize model',
      hint: 'Modifier',
      keywords: 'scale resize dimension size transform',
      run: () => openResizeModal(api),
    },
    {
      id: 'resize-fit-bed',
      title: 'Scale model to fit print bed',
      hint: 'Modifier',
      keywords: 'scale fit bed build volume printer shrink size resize plate',
      run: () => openResizeModal(api, { fitToBed: true }),
    },
  ]);

  const mount = () => {
    if (document.getElementById('resize-viewport-toggle')) return;
    // Land inside the Tools popover (after Surface, if present), matching the
    // neighbouring tool pill's styling.
    const styleRef = document.getElementById('surface-viewport-toggle')
      ?? document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
    btn.id = 'resize-viewport-toggle';
    btn.textContent = '⇲ Resize';
    btn.title = 'Scale the model along X, Y, and Z';
    btn.addEventListener('click', () => openResizeModal(api));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('resize-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
