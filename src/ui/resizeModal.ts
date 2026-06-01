// Resize/scale modal — a right-aligned, draggable panel that lets the user
// scale the current model along X, Y, and Z independently or uniformly.
// Uses the same bake-to-mesh strategy as the surface modifiers: Apply saves
// a new version with the scaled geometry on api.imports[0], so undo is just
// the version history. No code locking — the original parametric code is
// untouched; the scaled result is its own version.

import { registerCommands } from './commandPalette';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';

type ApplyResult = { error?: string; label?: string } | Record<string, unknown>;

export interface ResizeApi {
  scaleModel(sx: number, sy: number, sz: number, opts?: { preserveColor?: boolean }): Promise<ApplyResult>;
  previewScale(sx: number, sy: number, sz: number, opts?: { preserveColor?: boolean }): { ok: true } | { error: string };
  clearScalePreview(): { ok: true };
  getGeometryData(): { boundingBox?: { min?: number[]; max?: number[] } | null } | Record<string, unknown>;
  modelHasColor(): boolean;
}

type ScaleMode = 'percent' | 'units';

let openModal: HTMLDivElement | null = null;
let currentResizeClose: (() => void) | null = null;

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
    const gd = api.getGeometryData() as { boundingBox?: { min?: number[]; max?: number[] } | null };
    const bb = gd?.boundingBox;
    if (bb?.min && bb?.max) {
      const mn = bb.min as number[];
      const mx = bb.max as number[];
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

export function openResizeModal(api: ResizeApi): void {
  if (openModal) { openModal.remove(); openModal = null; currentResizeClose = null; }

  const bbox = getBbox(api);
  const size = bbox?.size ?? [10, 10, 10];

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

  let previewDirty = false;
  let previewTimer: number | undefined;

  const container = getViewportContainer();

  // Absolutely positioned inside the viewport container, below the toolbar.
  const panel = el('div', 'absolute z-[60] bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-700 shadow-xl w-[min(94vw,360px)] select-none flex flex-col');

  // Header — drag handle + title + × button.
  const header = el('div', 'flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0');
  header.append(el('h2', 'text-sm font-semibold', 'Resize model'));
  const closeBtn = el('button', 'text-zinc-400 hover:text-zinc-100 text-lg leading-none cursor-pointer', '×');
  closeBtn.setAttribute('aria-label', 'Close resize panel');
  header.append(closeBtn);
  panel.append(header);
  attachViewportPanelDrag(header, panel);

  const body = el('div', 'p-4 overflow-y-auto flex-1');
  panel.append(body);

  const status = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mt-1');

  // ---- Mode toggle (% / units) ----
  const modeRow = el('div', 'flex items-center gap-2 mb-4');
  modeRow.append(el('span', 'text-xs text-zinc-400', 'Scale by'));
  const btnPct = el('button', '', '%');
  const btnUnits = el('button', '', 'Raw units');
  const ACTIVE_TAB = 'px-2.5 py-1 rounded text-xs bg-sky-600 text-white';
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
  const uniformCheck = el('input', 'accent-sky-500');
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

  // ---- Preserve colors checkbox (only when the model has paint) ----
  if (hasColor) {
    const colorRow = el('label', 'flex items-center gap-2 mb-3 text-xs text-zinc-300 cursor-pointer');
    const colorCheck = el('input', 'accent-sky-500');
    colorCheck.type = 'checkbox';
    colorCheck.checked = preserveColor;
    colorCheck.addEventListener('change', () => {
      preserveColor = colorCheck.checked;
      schedulePreview();
    });
    colorRow.append(colorCheck, el('span', '', 'Preserve colors (best-effort)'));
    body.append(colorRow);
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
  const applyBtn = el('button', 'px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium', 'Apply');
  footer.append(resetBtn, cancelBtn, applyBtn);
  panel.append(footer);

  // ---- Axis slider builder ----
  function buildAxisControl(axis: 'X' | 'Y' | 'Z'): HTMLElement {
    const wrap = el('div', 'text-xs text-zinc-300');
    const labelRow = el('div', 'flex justify-between mb-1');
    const label = el('span', 'font-mono font-semibold text-zinc-200', axis);
    const readout = el('span', 'text-zinc-400 tabular-nums', '');
    labelRow.append(label, readout);

    const controlRow = el('div', 'flex items-center gap-2');
    const slider = el('input', 'flex-1 accent-sky-500');
    slider.type = 'range';
    const numInput = el('input', 'w-20 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 text-right text-zinc-200 font-mono focus:border-blue-400 focus:outline-none text-xs');
    numInput.type = 'number';
    controlRow.append(slider, numInput);
    wrap.append(labelRow, controlRow);

    function getValue() {
      if (mode === 'percent') return axis === 'X' ? pctX : axis === 'Y' ? pctY : pctZ;
      return axis === 'X' ? rawX : axis === 'Y' ? rawY : rawZ;
    }
    function getMax() { return mode === 'percent' ? maxPct : maxRaw; }
    function getMin() { return mode === 'percent' ? 1 : 0.001; }
    function getStep() { return mode === 'percent' ? 0.1 : 0.001; }

    function updateDisplay() {
      const v = getValue();
      readout.textContent = mode === 'percent' ? `${v.toFixed(1)}%` : `${v.toFixed(3)}`;
      numInput.value = mode === 'percent' ? v.toFixed(1) : v.toFixed(3);
      slider.min = String(getMin());
      slider.max = String(getMax());
      slider.step = String(getStep());
      slider.value = String(v);
    }

    function applyValue(v: number) {
      const clamped = Math.max(getMin(), Math.min(getMax(), v));
      if (mode === 'percent') {
        if (axis === 'X' || uniform) pctX = clamped;
        if (axis === 'Y' || uniform) pctY = clamped;
        if (axis === 'Z' || uniform) pctZ = clamped;
      } else {
        if (axis === 'X' || uniform) rawX = clamped;
        if (axis === 'Y' || uniform) rawY = clamped;
        if (axis === 'Z' || uniform) rawZ = clamped;
      }
      if (uniform) renderControls();
      else updateDisplay();
      schedulePreview();
    }

    slider.addEventListener('input', () => applyValue(slider.valueAsNumber));
    numInput.addEventListener('change', () => {
      const v = parseFloat(numInput.value);
      if (Number.isFinite(v)) applyValue(v);
    });

    updateDisplay();
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
      // Skip preview if scale is identity
      if (Math.abs(sx - 1) < 0.0001 && Math.abs(sy - 1) < 0.0001 && Math.abs(sz - 1) < 0.0001) {
        status.textContent = '';
        return;
      }
      const r = api.previewScale(sx, sy, sz, { preserveColor });
      if ((r as { error?: string }).error) {
        status.textContent = `Preview error: ${(r as { error: string }).error}`;
      } else {
        previewDirty = true;
        status.textContent = 'Previewing — Apply to save a new version.';
      }
    }, 120);
  }

  function clearPreview() {
    if (previewTimer !== undefined) { clearTimeout(previewTimer); previewTimer = undefined; }
    if (previewDirty) { api.clearScalePreview(); previewDirty = false; }
    status.textContent = '';
  }

  const close = () => {
    clearPreview();
    panel.remove();
    openModal = null;
    currentResizeClose = null;
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
      const result = await api.scaleModel(sx, sy, sz, { preserveColor });
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

  renderControls();
  container.append(panel);
  setInitialPanelPosition(panel);
  currentResizeClose = close;
  openViewportPanel(resizeRegistryEntry);
  document.addEventListener('keydown', onResizeEscape);
  openModal = panel as HTMLDivElement;
}

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

export function initResizeUI(api: ResizeApi): void {
  registerCommands([
    {
      id: 'resize-model',
      title: 'Resize model',
      hint: 'Modifier',
      keywords: 'scale resize dimension size transform',
      run: () => openResizeModal(api),
    },
  ]);

  const mount = () => {
    if (document.getElementById('resize-viewport-toggle')) return;
    const anchor = document.getElementById('surface-viewport-toggle')
      ?? document.getElementById('relief-viewport-toggle')
      ?? document.getElementById('paint-toggle')
      ?? document.querySelector<HTMLElement>('[id$="-viewport-toggle"]');
    if (!anchor || !anchor.parentElement) return;
    const btnCls = anchor.className.split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
    btn.id = 'resize-viewport-toggle';
    btn.textContent = '⇲ Resize';
    btn.title = 'Scale the model along X, Y, and Z';
    btn.addEventListener('click', () => openResizeModal(api));
    anchor.after(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('resize-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
