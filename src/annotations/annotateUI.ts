// Annotate UI — toggle button, sub-mode (pen/text/select) selector, color
// picker, width/font-size picker, restore-view, undo/redo/clear actions, count badge.

import {
  activate as activatePen,
  deactivate as deactivatePen,
  isActive as isPenActive,
  setColor as setPenColor,
  setWidth as setPenWidth,
  getWidth as getPenWidth,
  onActiveChange as onPenActiveChange,
} from './annotateMode';
import {
  activate as activateText,
  deactivate as deactivateText,
  isActive as isTextActive,
  setColor as setTextColor,
  setFontSize as setTextFontSize,
  getFontSize as getTextFontSize,
  onActiveChange as onTextActiveChange,
} from './textMode';
import {
  activate as activateSelect,
  deactivate as deactivateSelect,
  isActive as isSelectActive,
  getSelectedId,
  onActiveChange as onSelectActiveChange,
  onSelectionChange,
  restoreView as restoreSelectionView,
} from './selectMode';
import {
  getCount,
  onChange as onStrokesChange,
  onRedoChange,
  removeLastStroke,
  redoLastStroke,
  canRedoStroke,
  clearStrokes,
  clearAll,
} from './annotations';
import { setAnnotationsVisible, isAnnotationsVisible } from './annotationOverlay';
import { endSession as endSessionPlane, hidePlaneOutline } from './sessionPlane';
import { openViewportPanel, closeViewportPanel } from '../ui/viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from '../ui/viewportPanelDrag';

const PRESET_COLORS: [number, number, number][] = [
  [0.95, 0.20, 0.45], // hot pink (default)
  [0.92, 0.26, 0.21], // red
  [1.00, 0.76, 0.03], // yellow
  [0.30, 0.69, 0.31], // green
  [0.13, 0.59, 0.95], // blue
  [0.61, 0.15, 0.69], // purple
  [0.20, 0.20, 0.20], // near-black
  [0.96, 0.96, 0.96], // near-white
];

const PRESET_WIDTHS: { label: string; value: number }[] = [
  { label: 'XS', value: 2 },
  { label: 'S',  value: 4 },
  { label: 'M',  value: 7 },
  { label: 'L',  value: 12 },
];

const PRESET_FONT_SIZES: { label: string; value: number }[] = [
  { label: 'XS', value: 16 },
  { label: 'S',  value: 22 },
  { label: 'M',  value: 32 },
  { label: 'L',  value: 48 },
];

let annotateBtn: HTMLButtonElement | null = null;
let pickerPanel: HTMLElement | null = null;
let countBadge: HTMLElement | null = null;
let visibilityBtn: HTMLButtonElement | null = null;
let penTabBtn: HTMLButtonElement | null = null;
let textTabBtn: HTMLButtonElement | null = null;
let selectTabBtn: HTMLButtonElement | null = null;
let widthRow: HTMLElement | null = null;
let fontRow: HTMLElement | null = null;
let restoreViewBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let selectionInfo: HTMLElement | null = null;

const inactiveBtnClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const activeBtnClass = 'px-2 py-1 rounded text-xs bg-pink-500/30 backdrop-blur text-pink-200 border border-pink-400/60 transition-colors';

const tabInactiveClass = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-700/40 text-zinc-400 hover:bg-zinc-600/60 transition-colors';
const tabActiveClass = 'flex-1 px-2 py-1 rounded text-[11px] bg-pink-500/30 text-pink-200 ring-1 ring-pink-400/60 transition-colors';

export function initAnnotateUI(controlsContainer: HTMLElement): void {
  annotateBtn = document.createElement('button');
  annotateBtn.id = 'annotate-toggle';
  annotateBtn.className = inactiveBtnClass;
  annotateBtn.textContent = '\u270F\uFE0F Annotate';
  annotateBtn.title = 'Draw, type, or move marks pinned to a virtual plane in front of the model';

  countBadge = document.createElement('span');
  countBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-pink-500 text-white leading-none';
  annotateBtn.appendChild(countBadge);

  annotateBtn.addEventListener('click', toggleAnnotateMode);

  const paintBtn = controlsContainer.querySelector('#paint-toggle');
  const measureBtn = controlsContainer.querySelector('#measure-toggle');
  const anchor = paintBtn ?? measureBtn;
  if (anchor) controlsContainer.insertBefore(annotateBtn, anchor);
  else controlsContainer.appendChild(annotateBtn);

  pickerPanel = createPickerPanel();
  // Parent to the viewport container (same as paint panel) so the panel can be
  // positioned relative to the full viewport rather than the clip-controls box.
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(pickerPanel);

  onStrokesChange(updateCountBadge);
  onRedoChange(updateRedoButton);
  onPenActiveChange(updatePanelState);
  onTextActiveChange(updatePanelState);
  onSelectActiveChange(updatePanelState);
  onSelectionChange(updateSelectionInfo);
  updateCountBadge();
  updatePanelState();
  updateSelectionInfo(null);
  updateRedoButton();
}

function isAnyActive(): boolean {
  return isPenActive() || isTextActive() || isSelectActive();
}

function toggleAnnotateMode(): void {
  if (isAnyActive()) {
    deactivatePen();
    deactivateText();
    deactivateSelect();
    // No sub-mode active: tear down the session plane so the next activation
    // captures a fresh camera state and shows a fresh outline.
    hidePlaneOutline();
    endSessionPlane();
  } else {
    activatePen();
  }
}

function selectPenSubMode(): void {
  if (isPenActive()) return;
  activatePen();
}

function selectTextSubMode(): void {
  if (isTextActive()) return;
  activateText();
}

function selectSelectSubMode(): void {
  if (isSelectActive()) return;
  activateSelect();
}

const annotateRegistryEntry = { close(): void { closeAnnotatePanel(); } };

function onAnnotateEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  closeAnnotatePanel();
}

function updatePanelState(): void {
  if (!annotateBtn) return;
  const open = isAnyActive();
  const wasOpen = pickerPanel ? !pickerPanel.classList.contains('hidden') : false;
  annotateBtn.className = open ? activeBtnClass : inactiveBtnClass;
  if (open) {
    pickerPanel?.classList.remove('hidden');
    if (!wasOpen && pickerPanel) {
      setInitialPanelPosition(pickerPanel);
      openViewportPanel(annotateRegistryEntry);
      document.addEventListener('keydown', onAnnotateEscape);
    }
  } else {
    pickerPanel?.classList.add('hidden');
    if (wasOpen) {
      closeViewportPanel(annotateRegistryEntry);
      document.removeEventListener('keydown', onAnnotateEscape);
    }
  }

  if (penTabBtn && textTabBtn && selectTabBtn) {
    penTabBtn.className = isPenActive() ? tabActiveClass : tabInactiveClass;
    textTabBtn.className = isTextActive() ? tabActiveClass : tabInactiveClass;
    selectTabBtn.className = isSelectActive() ? tabActiveClass : tabInactiveClass;
  }
  if (widthRow) widthRow.classList.toggle('hidden', !isPenActive());
  if (fontRow) fontRow.classList.toggle('hidden', !isTextActive());
}

function updateSelectionInfo(id: string | null): void {
  if (!selectionInfo || !restoreViewBtn) return;
  if (id && isSelectActive()) {
    selectionInfo.classList.remove('hidden');
    restoreViewBtn.disabled = false;
    restoreViewBtn.classList.remove('opacity-40', 'cursor-not-allowed');
  } else {
    selectionInfo.classList.add('hidden');
    restoreViewBtn.disabled = true;
    restoreViewBtn.classList.add('opacity-40', 'cursor-not-allowed');
  }
}

function updateRedoButton(): void {
  if (!redoBtn) return;
  const can = canRedoStroke();
  redoBtn.disabled = !can;
  redoBtn.classList.toggle('opacity-40', !can);
  redoBtn.classList.toggle('cursor-not-allowed', !can);
}

function updateCountBadge(): void {
  if (!countBadge) return;
  const c = getCount();
  if (c > 0) {
    countBadge.textContent = String(c);
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }
}

function createPickerPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'annotate-picker-panel';
  panel.className = 'hidden absolute z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg shadow-xl';
  panel.style.minWidth = '220px';

  // Header: drag handle + title + × close button.
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between px-2.5 py-2 border-b border-zinc-700/70';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'text-[11px] text-zinc-300 font-medium';
  headerTitle.textContent = '✏️ Annotate';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 transition-colors leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700/60';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close annotate menu';
  closeBtn.setAttribute('aria-label', 'Close annotate menu');
  closeBtn.addEventListener('click', () => { toggleAnnotateMode(); });
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  attachViewportPanelDrag(header, panel);

  // Padded content beneath the header.
  const content = document.createElement('div');
  content.className = 'p-2.5';
  panel.appendChild(content);

  // Info banner — explains the purpose of annotations to the user.
  const info = document.createElement('div');
  info.className = 'mb-2 p-2 rounded bg-pink-500/10 border border-pink-400/30 text-[10px] text-pink-200 leading-snug';
  info.textContent = 'Annotations are saved with this session and exported in the JSON. Use them to point out specific improvements for an AI working on the model.';
  content.appendChild(info);

  // Sub-mode tabs
  const tabsRow = document.createElement('div');
  tabsRow.className = 'flex items-center gap-1.5 mb-2';

  penTabBtn = document.createElement('button');
  penTabBtn.className = tabInactiveClass;
  penTabBtn.textContent = '\u270F\uFE0F Pen';
  penTabBtn.title = 'Draw freehand strokes on the session plane';
  penTabBtn.addEventListener('click', selectPenSubMode);
  tabsRow.appendChild(penTabBtn);

  textTabBtn = document.createElement('button');
  textTabBtn.className = tabInactiveClass;
  textTabBtn.textContent = 'T Text';
  textTabBtn.title = 'Click the plane to pin a text label';
  textTabBtn.addEventListener('click', selectTextSubMode);
  tabsRow.appendChild(textTabBtn);

  selectTabBtn = document.createElement('button');
  selectTabBtn.className = tabInactiveClass;
  selectTabBtn.textContent = '\u2716 Select';
  selectTabBtn.title = 'Click an annotation to select; drag to move; Delete to remove';
  selectTabBtn.addEventListener('click', selectSelectSubMode);
  tabsRow.appendChild(selectTabBtn);

  content.appendChild(tabsRow);

  // Color
  const title = document.createElement('div');
  title.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  title.textContent = 'Color';
  content.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-4 gap-1.5 mb-2';

  for (const color of PRESET_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'w-6 h-6 rounded border-2 border-transparent hover:border-white/50 transition-colors';
    swatch.style.backgroundColor = rgbToCSS(color);
    swatch.title = rgbToHex(color);
    swatch.addEventListener('click', () => {
      setPenColor(color);
      setTextColor(color);
      markActiveSwatch(grid, swatch);
    });
    grid.appendChild(swatch);
  }
  const first = grid.children[0] as HTMLElement;
  if (first) first.classList.add('border-white/80', 'ring-1', 'ring-white/30');
  content.appendChild(grid);

  // Custom color
  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-1.5 mb-2';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = rgbToHex(PRESET_COLORS[0]);
  colorInput.className = 'w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent';
  colorInput.title = 'Custom color';
  colorInput.addEventListener('input', () => {
    const hex = colorInput.value;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    setPenColor([r, g, b]);
    setTextColor([r, g, b]);
    for (const child of Array.from(grid.children)) {
      (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
    }
  });
  const customLabel = document.createElement('span');
  customLabel.className = 'text-[10px] text-zinc-500';
  customLabel.textContent = 'Custom';
  customRow.appendChild(colorInput);
  customRow.appendChild(customLabel);
  content.appendChild(customRow);

  // Width row (Pen mode)
  widthRow = document.createElement('div');
  widthRow.className = 'mt-2';
  const widthLabel = document.createElement('div');
  widthLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  widthLabel.textContent = 'Width';
  widthRow.appendChild(widthLabel);
  const widthBtns = document.createElement('div');
  widthBtns.className = 'flex items-center gap-1.5';
  const widthButtonRefs: HTMLButtonElement[] = [];
  for (const preset of PRESET_WIDTHS) {
    const btn = document.createElement('button');
    btn.className = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors flex items-center justify-center gap-1.5';
    btn.title = `${preset.value}px`;
    const dot = document.createElement('span');
    dot.className = 'rounded-full bg-zinc-300';
    const sz = Math.max(2, Math.min(12, preset.value));
    dot.style.width = `${sz}px`;
    dot.style.height = `${sz}px`;
    btn.appendChild(dot);
    const lbl = document.createElement('span');
    lbl.textContent = preset.label;
    btn.appendChild(lbl);
    btn.addEventListener('click', () => {
      setPenWidth(preset.value);
      markActiveSizeButton(widthButtonRefs, btn);
    });
    widthButtonRefs.push(btn);
    widthBtns.appendChild(btn);
  }
  widthRow.appendChild(widthBtns);
  const initialWidthIdx = PRESET_WIDTHS.findIndex(w => w.value === getPenWidth());
  if (initialWidthIdx >= 0) markActiveSizeButton(widthButtonRefs, widthButtonRefs[initialWidthIdx]);
  content.appendChild(widthRow);

  // Font size row (Text mode)
  fontRow = document.createElement('div');
  fontRow.className = 'mt-2 hidden';
  const fontLabel = document.createElement('div');
  fontLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  fontLabel.textContent = 'Size';
  fontRow.appendChild(fontLabel);
  const fontBtns = document.createElement('div');
  fontBtns.className = 'flex items-center gap-1.5';
  const fontButtonRefs: HTMLButtonElement[] = [];
  for (const preset of PRESET_FONT_SIZES) {
    const btn = document.createElement('button');
    btn.className = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
    btn.title = `${preset.value}px`;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      setTextFontSize(preset.value);
      markActiveSizeButton(fontButtonRefs, btn);
    });
    fontButtonRefs.push(btn);
    fontBtns.appendChild(btn);
  }
  fontRow.appendChild(fontBtns);
  const initialFontIdx = PRESET_FONT_SIZES.findIndex(f => f.value === getTextFontSize());
  if (initialFontIdx >= 0) markActiveSizeButton(fontButtonRefs, fontButtonRefs[initialFontIdx]);
  content.appendChild(fontRow);

  // Selection info row (Select mode)
  selectionInfo = document.createElement('div');
  selectionInfo.className = 'hidden mt-2 pt-2 border-t border-zinc-700 text-[10px] text-zinc-400';
  selectionInfo.textContent = 'Drag to move. Delete to remove.';
  content.appendChild(selectionInfo);

  // Action row: visibility, restore-view, undo, redo, clear
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700 flex-wrap';

  visibilityBtn = document.createElement('button');
  visibilityBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  visibilityBtn.textContent = isAnnotationsVisible() ? 'Hide' : 'Show';
  visibilityBtn.title = 'Toggle annotation visibility';
  visibilityBtn.addEventListener('click', () => {
    const next = !isAnnotationsVisible();
    setAnnotationsVisible(next);
    if (visibilityBtn) visibilityBtn.textContent = next ? 'Hide' : 'Show';
  });
  actions.appendChild(visibilityBtn);

  restoreViewBtn = document.createElement('button');
  restoreViewBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  restoreViewBtn.textContent = 'View from here';
  restoreViewBtn.title = 'Snap the camera to the angle from which the selected annotation was made';
  restoreViewBtn.disabled = true;
  restoreViewBtn.addEventListener('click', () => {
    const id = getSelectedId();
    if (id) restoreSelectionView(id);
  });
  actions.appendChild(restoreViewBtn);

  const undoBtn = document.createElement('button');
  undoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  undoBtn.textContent = 'Undo stroke';
  undoBtn.title = 'Remove the most recent freehand stroke';
  undoBtn.addEventListener('click', () => { removeLastStroke(); });
  actions.appendChild(undoBtn);

  redoBtn = document.createElement('button');
  redoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  redoBtn.textContent = 'Redo stroke';
  redoBtn.title = 'Restore the most recently undone freehand stroke';
  redoBtn.disabled = true;
  redoBtn.addEventListener('click', () => { redoLastStroke(); });
  actions.appendChild(redoBtn);

  const clearStrokesBtn = document.createElement('button');
  clearStrokesBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  clearStrokesBtn.textContent = 'Clear strokes';
  clearStrokesBtn.title = 'Remove all freehand strokes (keeps text)';
  clearStrokesBtn.addEventListener('click', () => { clearStrokes(); });
  actions.appendChild(clearStrokesBtn);

  const clearAllBtn = document.createElement('button');
  clearAllBtn.className = 'px-2 py-1 rounded text-[10px] bg-red-700/60 text-red-200 hover:bg-red-600/60 transition-colors';
  clearAllBtn.textContent = 'Clear all';
  clearAllBtn.title = 'Remove all annotations';
  clearAllBtn.addEventListener('click', () => { clearAll(); });
  actions.appendChild(clearAllBtn);

  content.appendChild(actions);

  return panel;
}

function markActiveSwatch(grid: HTMLElement, activeSwatch: HTMLElement): void {
  for (const child of Array.from(grid.children)) {
    (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
  }
  activeSwatch.classList.add('border-white/80', 'ring-1', 'ring-white/30');
}

function markActiveSizeButton(buttons: HTMLButtonElement[], active: HTMLButtonElement): void {
  for (const b of buttons) {
    b.classList.remove('bg-zinc-500/60', 'ring-1', 'ring-white/30');
    b.classList.add('bg-zinc-700/60');
  }
  active.classList.remove('bg-zinc-700/60');
  active.classList.add('bg-zinc-500/60', 'ring-1', 'ring-white/30');
}

function rgbToCSS(color: [number, number, number]): string {
  return `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
}

function rgbToHex(color: [number, number, number]): string {
  const r = Math.round(color[0] * 255).toString(16).padStart(2, '0');
  const g = Math.round(color[1] * 255).toString(16).padStart(2, '0');
  const b = Math.round(color[2] * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function closeAnnotatePanel(): void {
  if (!isAnyActive() && (!pickerPanel || pickerPanel.classList.contains('hidden'))) return;
  deactivatePen();
  deactivateText();
  deactivateSelect();
  hidePlaneOutline();
  endSessionPlane();
  // updatePanelState fires via onXActiveChange callbacks and handles hiding + registry cleanup.
  // Fallback: if all modes were already inactive the callbacks don't fire — clean up directly.
  if (!isAnyActive() && pickerPanel && !pickerPanel.classList.contains('hidden')) {
    pickerPanel.classList.add('hidden');
    if (annotateBtn) annotateBtn.className = inactiveBtnClass;
    closeViewportPanel(annotateRegistryEntry);
    document.removeEventListener('keydown', onAnnotateEscape);
  }
}

/** Force-deactivate annotate (pen) externally — used by the paint mode UI for
 *  mutual exclusion. Note: text and select modes are deactivated separately. */
export function forceDeactivate(): void {
  if (isPenActive()) deactivatePen();
}

/** Returns true if any annotate sub-mode (pen/text/select) is active. */
export function isAnnotateOpen(): boolean {
  return isAnyActive();
}

/** Close the annotate menu and tear down the session plane.
 *  Mirrors the close branch of the toolbar toggle so the same teardown
 *  events fire (mode-active callbacks, panel hide, plane outline cleanup). */
export function closeMenu(): void {
  if (!isAnyActive()) return;
  deactivatePen();
  deactivateText();
  deactivateSelect();
  hidePlaneOutline();
  endSessionPlane();
}
