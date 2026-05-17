// Sculpt mode UI — toolbar button, brush picker (Push / Smooth),
// radius + strength sliders, subdivide button, apply + discard
// actions. Mirrors paintUI in floor plan.

import {
  activate,
  deactivate,
  isActive,
  setBrush,
  getBrush,
  setRadius,
  getRadius,
  setStrength,
  getStrength,
  subdivideOnce,
  discardPending,
  rebuildFromStrokes,
} from '../sculpt/sculptMode';
import {
  hasStrokes,
  getStrokes,
  getSubdivisionLevel,
  popLastStroke,
  clearStrokes,
  onChange as onStrokesChange,
} from '../sculpt/strokes';
import type { BrushKind } from '../sculpt/types';
import { forceDeactivate as forceDeactivatePaint } from '../color/paintUI';

let sculptBtn: HTMLButtonElement | null = null;
let pickerPanel: HTMLElement | null = null;
let strokeCountBadge: HTMLElement | null = null;
let brushButtons: Partial<Record<BrushKind, HTMLButtonElement>> = {};
let subdivLabel: HTMLElement | null = null;
let undoBtn: HTMLButtonElement | null = null;

let onApplyCallback: (() => Promise<void> | void) | null = null;

export function setOnApply(fn: () => Promise<void> | void): void {
  onApplyCallback = fn;
}

export function initSculptUI(controlsContainer: HTMLElement): void {
  sculptBtn = document.createElement('button');
  sculptBtn.id = 'sculpt-toggle';
  sculptBtn.className = inactiveButtonClass();
  sculptBtn.textContent = '\u{1F9F1} Sculpt';
  sculptBtn.title = 'Sculpt the mesh surface with brush strokes';

  strokeCountBadge = document.createElement('span');
  strokeCountBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white leading-none';
  sculptBtn.appendChild(strokeCountBadge);

  sculptBtn.addEventListener('click', toggleSculptMode);

  // Insert next to the paint button if present, otherwise just append.
  const paintBtn = controlsContainer.querySelector('#paint-toggle');
  if (paintBtn && paintBtn.parentElement === controlsContainer) {
    controlsContainer.insertBefore(sculptBtn, paintBtn.nextSibling);
  } else {
    const measureBtn = controlsContainer.querySelector('#measure-toggle');
    if (measureBtn) controlsContainer.insertBefore(sculptBtn, measureBtn);
    else controlsContainer.appendChild(sculptBtn);
  }

  pickerPanel = createPickerPanel();
  controlsContainer.appendChild(pickerPanel);

  onStrokesChange(() => {
    updateBadge();
    updateSubdivLabel();
    updateUndoButton();
  });

  updateBadge();
  updateSubdivLabel();
  updateUndoButton();
}

function toggleSculptMode(): void {
  if (isActive()) {
    deactivate();
    updateButtonState(false);
    pickerPanel?.classList.add('hidden');
  } else {
    // Mutually exclusive with paint mode.
    forceDeactivatePaint();
    activate();
    updateButtonState(true);
    pickerPanel?.classList.remove('hidden');
  }
}

function inactiveButtonClass(): string {
  return 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
}

function activeButtonClass(): string {
  return 'px-2 py-1 rounded text-xs bg-emerald-500/30 backdrop-blur text-emerald-300 border border-emerald-500/50 transition-colors';
}

function updateButtonState(on: boolean): void {
  if (!sculptBtn) return;
  sculptBtn.className = on ? activeButtonClass() : inactiveButtonClass();
}

function updateBadge(): void {
  if (!strokeCountBadge) return;
  const count = getStrokes().length;
  if (count > 0) {
    strokeCountBadge.textContent = String(count);
    strokeCountBadge.classList.remove('hidden');
  } else {
    strokeCountBadge.classList.add('hidden');
  }
}

function createPickerPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'sculpt-picker-panel';
  panel.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  panel.style.minWidth = '220px';
  panel.style.maxWidth = '260px';

  // === Brush selector ===
  panel.appendChild(sectionTitle('Brush'));
  const brushRow = document.createElement('div');
  brushRow.className = 'grid grid-cols-2 gap-1 mb-2';
  brushRow.appendChild(createBrushButton('push', 'Push', 'Push vertices outward along the surface normal'));
  brushRow.appendChild(createBrushButton('smooth', 'Smooth', 'Average neighboring vertex positions (relax bumps)'));
  panel.appendChild(brushRow);

  // === Radius slider ===
  panel.appendChild(sectionTitle('Radius'));
  const radiusRow = sliderRow(
    0.5, 10, 0.1, getRadius(),
    'sculpt-radius',
    v => { setRadius(v); },
  );
  panel.appendChild(radiusRow.wrap);

  // === Strength slider ===
  panel.appendChild(sectionTitle('Strength'));
  const strengthRow = sliderRow(
    0, 1, 0.01, getStrength(),
    'sculpt-strength',
    v => { setStrength(v); },
  );
  panel.appendChild(strengthRow.wrap);

  // === Subdivide ===
  panel.appendChild(sectionTitle('Subdivision'));
  const subRow = document.createElement('div');
  subRow.className = 'flex items-center gap-2 mb-2';
  const subBtn = document.createElement('button');
  subBtn.id = 'sculpt-subdivide';
  subBtn.className = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors border border-zinc-600/50';
  subBtn.textContent = 'Subdivide mesh ×1';
  subBtn.title = 'Split every triangle into 4 to add detail';
  subBtn.addEventListener('click', () => { subdivideOnce(); });
  subRow.appendChild(subBtn);

  subdivLabel = document.createElement('span');
  subdivLabel.className = 'text-[10px] text-zinc-500 font-mono';
  subdivLabel.textContent = 'lvl 0';
  subRow.appendChild(subdivLabel);
  panel.appendChild(subRow);

  // === Action row ===
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700 flex-wrap';

  undoBtn = document.createElement('button');
  undoBtn.id = 'sculpt-undo';
  undoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Discard the most recent stroke (then click Apply to re-replay)';
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', () => {
    popLastStroke();
    // The strokes list shrunk — rebuild the working mesh from the
    // base mesh by replaying the now-shorter stroke history so the
    // next stroke starts from the correct state.
    rebuildFromStrokes();
  });
  actions.appendChild(undoBtn);

  const discardBtn = document.createElement('button');
  discardBtn.id = 'sculpt-discard';
  discardBtn.className = 'px-2 py-1 rounded text-[10px] bg-red-700/60 text-red-200 hover:bg-red-600/60 transition-colors';
  discardBtn.textContent = 'Discard';
  discardBtn.title = 'Discard all unsaved sculpt strokes and subdivision';
  discardBtn.addEventListener('click', () => {
    clearStrokes();
    discardPending();
  });
  actions.appendChild(discardBtn);

  const applyBtn = document.createElement('button');
  applyBtn.id = 'sculpt-apply';
  applyBtn.className = 'ml-auto px-2 py-1 rounded text-[10px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors';
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Persist these strokes to the current version (saves a new version)';
  applyBtn.addEventListener('click', async () => {
    if (onApplyCallback) {
      try { await onApplyCallback(); }
      catch (e) { console.error('sculpt apply failed:', e); }
    }
  });
  actions.appendChild(applyBtn);

  panel.appendChild(actions);

  return panel;
}

function sectionTitle(text: string): HTMLElement {
  const t = document.createElement('div');
  t.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  t.textContent = text;
  return t;
}

function createBrushButton(kind: BrushKind, label: string, tooltip: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = brushButtonClass(kind === getBrush());
  btn.textContent = label;
  btn.title = tooltip;
  btn.dataset.brush = kind;
  btn.addEventListener('click', () => {
    setBrush(kind);
    syncBrushButtons();
  });
  brushButtons[kind] = btn;
  return btn;
}

function brushButtonClass(active: boolean): string {
  if (active) return 'px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center';
  return 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

function syncBrushButtons(): void {
  const current = getBrush();
  for (const [k, btn] of Object.entries(brushButtons)) {
    if (btn) btn.className = brushButtonClass(k === current);
  }
}

function sliderRow(
  min: number,
  max: number,
  step: number,
  initial: number,
  id: string,
  onInput: (v: number) => void,
): { wrap: HTMLElement; valueSpan: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-2';
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(initial);
  slider.className = 'flex-1 accent-blue-500';
  const valueSpan = document.createElement('span');
  valueSpan.className = 'text-[10px] text-zinc-400 font-mono w-10 text-right';
  valueSpan.textContent = initial.toFixed(2);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    onInput(v);
    valueSpan.textContent = v.toFixed(2);
  });
  row.appendChild(slider);
  row.appendChild(valueSpan);
  wrap.appendChild(row);
  return { wrap, valueSpan };
}

function updateSubdivLabel(): void {
  if (!subdivLabel) return;
  subdivLabel.textContent = `lvl ${getSubdivisionLevel()}`;
}

function updateUndoButton(): void {
  if (!undoBtn) return;
  const can = hasStrokes();
  undoBtn.disabled = !can;
  undoBtn.classList.toggle('opacity-40', !can);
  undoBtn.classList.toggle('cursor-not-allowed', !can);
}

/** Externally close the sculpt panel (e.g. when paint mode activates). */
export function forceDeactivate(): void {
  if (isActive()) {
    deactivate();
    updateButtonState(false);
    pickerPanel?.classList.add('hidden');
  }
}

export function isSculptOpen(): boolean {
  return isActive();
}
