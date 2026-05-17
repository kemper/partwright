// Sculpt UI — toggle button + floating panel mirroring the paint overlay.
// Provides the Inflate / Smooth kind toggle, a single parameter slider,
// and Apply / Cancel buttons. Visible only when sculpt mode is active.

import {
  activate as activateSculpt,
  deactivate as deactivateSculpt,
  isActive as isSculptActive,
  setKind,
  getKind,
  setInflateDistance,
  getInflateDistance,
  setSmoothIterations,
  getSmoothIterations,
  setBucketTolerance,
  getBucketTolerance,
  getCurrentSelection,
  setOnSelectionChange,
  setOnKindChange,
  clearSelection,
} from '../sculpt/sculptMode';
import type { DeformerKind } from '../sculpt/types';
import {
  getDeformers,
  onChange as onDeformerStoreChange,
} from '../sculpt/deformerStore';

let sculptBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let countBadge: HTMLElement | null = null;
let kindButtons: Partial<Record<DeformerKind, HTMLButtonElement>> = {};
let inflateControls: HTMLElement | null = null;
let smoothControls: HTMLElement | null = null;
let applyBtn: HTMLButtonElement | null = null;
let selectionStatus: HTMLElement | null = null;

// Provided by main.ts — runs the deformer + saves + locks the editor.
let applyHandler: (() => Promise<void>) | null = null;

export function setSculptApplyHandler(fn: () => Promise<void>): void {
  applyHandler = fn;
}

export function initSculptUI(controlsContainer: HTMLElement): void {
  sculptBtn = document.createElement('button');
  sculptBtn.id = 'sculpt-toggle';
  sculptBtn.className = baseBtnClass();
  sculptBtn.innerHTML = '⛰️ Sculpt'; // mountain emoji
  sculptBtn.title = 'Sculpt mode: pick a region and apply a named deformer (Inflate / Smooth)';

  countBadge = document.createElement('span');
  countBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500 text-white leading-none';
  sculptBtn.appendChild(countBadge);

  sculptBtn.addEventListener('click', toggle);

  // Insert next to the Paint button if it exists, else append.
  const paintBtn = controlsContainer.querySelector('#paint-toggle');
  if (paintBtn && paintBtn.nextSibling) {
    controlsContainer.insertBefore(sculptBtn, paintBtn.nextSibling);
  } else if (paintBtn) {
    controlsContainer.appendChild(sculptBtn);
  } else {
    controlsContainer.appendChild(sculptBtn);
  }

  panel = createPanel();
  controlsContainer.appendChild(panel);

  setOnSelectionChange(refreshApplyState);
  setOnKindChange(syncKindPanels);
  onDeformerStoreChange(updateBadge);

  updateBadge();
  refreshApplyState();
}

function toggle(): void {
  if (isSculptActive()) {
    deactivateSculpt();
    updateBtnState(false);
    panel?.classList.add('hidden');
  } else {
    activateSculpt();
    updateBtnState(true);
    panel?.classList.remove('hidden');
    syncKindPanels();
    refreshApplyState();
  }
}

function baseBtnClass(): string {
  return 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
}

function activeBtnClass(): string {
  return 'px-2 py-1 rounded text-xs bg-purple-500/30 backdrop-blur text-purple-200 border border-purple-500/50 transition-colors';
}

function updateBtnState(active: boolean): void {
  if (!sculptBtn) return;
  sculptBtn.className = active ? activeBtnClass() : baseBtnClass();
}

function updateBadge(): void {
  if (!countBadge) return;
  const count = getDeformers().length;
  if (count > 0) {
    countBadge.textContent = String(count);
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }
}

function createPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'sculpt-panel';
  p.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  p.style.minWidth = '220px';
  p.style.maxWidth = '260px';

  // Kind selector
  const kindTitle = document.createElement('div');
  kindTitle.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  kindTitle.textContent = 'Deformer';
  p.appendChild(kindTitle);

  const kindRow = document.createElement('div');
  kindRow.className = 'grid grid-cols-2 gap-1 mb-2.5';
  kindRow.appendChild(createKindButton('inflate', '\u{1F388} Inflate', 'Push region vertices outward along their averaged vertex normals'));
  kindRow.appendChild(createKindButton('smooth', '\u{1F30A} Smooth', 'Laplacian smoothing inside the region (boundary pinned)'));
  p.appendChild(kindRow);

  // Tolerance
  p.appendChild(createBucketToleranceControl());

  // Per-kind params
  inflateControls = createInflateControls();
  p.appendChild(inflateControls);
  smoothControls = createSmoothControls();
  p.appendChild(smoothControls);

  // Selection status
  selectionStatus = document.createElement('div');
  selectionStatus.id = 'sculpt-selection-status';
  selectionStatus.className = 'mt-2 pt-2 border-t border-zinc-700 text-[11px] text-zinc-500';
  selectionStatus.textContent = 'Click the mesh to select a region.';
  p.appendChild(selectionStatus);

  // Action row
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700';

  applyBtn = document.createElement('button');
  applyBtn.className = applyButtonClass(false);
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Apply the current deformer to the selected region (saves a new version)';
  applyBtn.disabled = true;
  applyBtn.addEventListener('click', async () => {
    if (!applyHandler) return;
    applyBtn!.disabled = true;
    try {
      await applyHandler();
    } catch (err) {
      console.warn('Sculpt: applyHandler threw', err);
    }
    refreshApplyState();
  });
  actions.appendChild(applyBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-2 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.title = 'Discard the current selection';
  cancelBtn.addEventListener('click', () => {
    clearSelection();
    refreshApplyState();
  });
  actions.appendChild(cancelBtn);

  p.appendChild(actions);
  return p;
}

function applyButtonClass(enabled: boolean): string {
  if (enabled) {
    return 'px-2 py-1 rounded text-[11px] bg-purple-500/40 text-purple-100 hover:bg-purple-500/60 border border-purple-500/60 transition-colors';
  }
  return 'px-2 py-1 rounded text-[11px] bg-zinc-700/40 text-zinc-500 cursor-not-allowed border border-transparent';
}

function createKindButton(kind: DeformerKind, label: string, tooltip: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.dataset.kind = kind;
  btn.className = kindButtonClass(kind === getKind());
  btn.innerHTML = label;
  btn.title = tooltip;
  btn.addEventListener('click', () => {
    setKind(kind);
    syncKindPanels();
  });
  kindButtons[kind] = btn;
  return btn;
}

function kindButtonClass(active: boolean): string {
  if (active) {
    return 'px-1.5 py-1 rounded text-[10px] bg-purple-500/30 text-purple-200 border border-purple-500/50 transition-colors text-center';
  }
  return 'px-1.5 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

function syncKindPanels(): void {
  const kind = getKind();
  for (const [k, btn] of Object.entries(kindButtons)) {
    if (btn) btn.className = kindButtonClass(k === kind);
  }
  if (inflateControls) inflateControls.classList.toggle('hidden', kind !== 'inflate');
  if (smoothControls) smoothControls.classList.toggle('hidden', kind !== 'smooth');
}

function createBucketToleranceControl(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-1 mb-2';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium flex items-center justify-between';
  const labelText = document.createElement('span');
  labelText.textContent = 'Region tolerance';
  const valueSpan = document.createElement('span');
  valueSpan.className = 'text-zinc-400 normal-case tracking-normal';
  valueSpan.textContent = formatTolerance(getBucketTolerance());
  label.appendChild(labelText);
  label.appendChild(valueSpan);
  wrap.appendChild(label);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(toleranceToSliderPct(getBucketTolerance()));
  slider.className = 'w-full accent-purple-500';
  slider.title = 'Maximum bend angle between adjacent faces the region selector will cross';
  slider.addEventListener('input', () => {
    const tol = sliderPctToTolerance(parseInt(slider.value, 10));
    setBucketTolerance(tol);
    valueSpan.textContent = formatTolerance(tol);
  });
  wrap.appendChild(slider);

  return wrap;
}

function toleranceToSliderPct(tol: number): number {
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, tol))) * 180 / Math.PI;
  return Math.round(Math.max(0, Math.min(180, angleDeg)) / 180 * 100);
}

function sliderPctToTolerance(pct: number): number {
  const angleDeg = Math.max(0, Math.min(100, pct)) / 100 * 180;
  return Math.cos(angleDeg * Math.PI / 180);
}

function formatTolerance(tol: number): string {
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, tol))) * 180 / Math.PI;
  return `≤ ${angleDeg.toFixed(1)}°`;
}

function createInflateControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium flex items-center justify-between';
  const labelText = document.createElement('span');
  labelText.textContent = 'Inflate distance';
  const valueSpan = document.createElement('span');
  valueSpan.className = 'text-zinc-400 normal-case tracking-normal';
  valueSpan.textContent = getInflateDistance().toFixed(2);
  label.appendChild(labelText);
  label.appendChild(valueSpan);
  wrap.appendChild(label);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '-5';
  slider.max = '5';
  slider.step = '0.05';
  slider.value = String(getInflateDistance());
  slider.className = 'w-full accent-purple-500';
  slider.title = 'Distance (signed) to push each region vertex along its averaged normal';
  slider.addEventListener('input', () => {
    const d = parseFloat(slider.value);
    setInflateDistance(d);
    valueSpan.textContent = d.toFixed(2);
  });
  wrap.appendChild(slider);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 mt-1';
  hint.textContent = 'Negative values deflate (inward).';
  wrap.appendChild(hint);

  return wrap;
}

function createSmoothControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700 hidden';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium flex items-center justify-between';
  const labelText = document.createElement('span');
  labelText.textContent = 'Smooth iterations';
  const valueSpan = document.createElement('span');
  valueSpan.className = 'text-zinc-400 normal-case tracking-normal';
  valueSpan.textContent = String(getSmoothIterations());
  label.appendChild(labelText);
  label.appendChild(valueSpan);
  wrap.appendChild(label);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '20';
  slider.step = '1';
  slider.value = String(getSmoothIterations());
  slider.className = 'w-full accent-purple-500';
  slider.title = 'Number of Laplacian smoothing iterations to run';
  slider.addEventListener('input', () => {
    const n = parseInt(slider.value, 10);
    setSmoothIterations(n);
    valueSpan.textContent = String(n);
  });
  wrap.appendChild(slider);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 mt-1';
  hint.textContent = 'Region boundary vertices stay pinned to prevent tearing.';
  wrap.appendChild(hint);

  return wrap;
}

function refreshApplyState(): void {
  const sel = getCurrentSelection();
  if (selectionStatus) {
    selectionStatus.textContent = sel
      ? `${sel.triangles.size} triangle${sel.triangles.size === 1 ? '' : 's'} selected.`
      : 'Click the mesh to select a region.';
  }
  const canApply = !!sel && sel.triangles.size > 0;
  if (applyBtn) {
    applyBtn.disabled = !canApply;
    applyBtn.className = applyButtonClass(canApply);
  }
}

/** Deactivate sculpt mode externally (e.g. when switching tabs). */
export function forceDeactivate(): void {
  if (isSculptActive()) {
    deactivateSculpt();
    updateBtnState(false);
    panel?.classList.add('hidden');
  }
}

/** True if the sculpt panel is open. */
export function isSculptOpen(): boolean {
  return isSculptActive();
}
