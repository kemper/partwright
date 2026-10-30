// Annotate UI — toggle button, sub-mode (pen/text/select) selector, color
// picker, width/font-size picker, restore-view, undo/redo/clear actions, count badge.

import {
  activate as activatePen,
  deactivate as deactivatePen,
  isActive as isPenActive,
  setColor as setPenColor,
  getColor as getPenColor,
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
import { endSession as endSessionPlane, hidePlaneOutline, restoreCameraView } from './sessionPlane';
import { setDraftScope, getDrafts } from './annotations';
import {
  getAnnotateStyle,
  setAnnotateStyle,
  onAnnotateStyleChange,
  getAnnotationViews,
  onAnnotationViewsChange,
  deleteAnnotationView,
  type AnnotateStyle,
} from './annotationViews';
import { captureAnnotationView, restoreAnnotationViewCamera, attachAnnotationViewToChat } from './viewCapture';
import { describeViewHits, type AnnotationView } from './annotationViewTypes';
import { showToast } from '../ui/toast';
import { BUTTON_SMALL_PRIMARY, BUTTON_SMALL_SECONDARY, BUTTON_SMALL_DANGER } from '../ui/styleConstants';
import { openViewportPanel, closeViewportPanel } from '../ui/viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from '../ui/viewportPanelDrag';
import { viewportToolsMount } from '../ui/popoverMenu';
import { createToolPanelHeader, TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from '../ui/toolPanel';
import { createColorSwatch } from '../ui/colorPickerModal';
import { registerTool, setToolNote, type ToolOpenContext, type ToolOpenResult } from '../ui/toolRegistry';

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
/** Panel content (the AI note lands at its top). */
let annotateContentEl: HTMLElement | null = null;
/** Programmatic UI sync hooks set by createPickerPanel (openTool prefill). */
let syncColorUI: ((c: [number, number, number]) => void) | null = null;
let syncWidthUI: (() => void) | null = null;
let syncFontUI: (() => void) | null = null;
let snapshotTabBtn: HTMLButtonElement | null = null;
let floatingTabBtn: HTMLButtonElement | null = null;
let styleInfo: HTMLElement | null = null;
let saveViewBtn: HTMLButtonElement | null = null;
let viewTitleInput: HTMLInputElement | null = null;
let historyHeader: HTMLElement | null = null;
let historyList: HTMLElement | null = null;

const inactiveBtnClass = TOOL_TOGGLE_IDLE;
const activeBtnClass = TOOL_TOGGLE_ACTIVE;

const tabInactiveClass = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-700/40 text-zinc-400 hover:bg-zinc-600/60 transition-colors';
const tabActiveClass = 'flex-1 px-2 py-1 rounded text-[11px] bg-blue-500/30 text-blue-200 ring-1 ring-blue-400/60 transition-colors';

export function initAnnotateUI(controlsContainer: HTMLElement): void {
  annotateBtn = document.createElement('button');
  annotateBtn.id = 'annotate-toggle';
  annotateBtn.className = inactiveBtnClass;
  annotateBtn.textContent = '\u270F\uFE0F Annotate';
  annotateBtn.title = 'Draw, type, or move marks pinned to a virtual plane in front of the model';

  countBadge = document.createElement('span');
  countBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white leading-none';
  annotateBtn.appendChild(countBadge);

  annotateBtn.addEventListener('click', toggleAnnotateMode);

  // Mount the button into the Tools popover (falls back to the bar itself).
  // Order within the popover follows init order; no sibling anchoring needed.
  viewportToolsMount(controlsContainer).appendChild(annotateBtn);

  pickerPanel = createPickerPanel();
  // Parent to the viewport container (same as paint panel) so the panel can be
  // positioned relative to the full viewport rather than the clip-controls box.
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(pickerPanel);

  registerTool({
    id: 'tool-annotate',
    title: 'Annotate (draw / text)',
    hint: 'Tools',
    prefillSchema: {
      mode: { type: 'enum', values: ['pen', 'text', 'select'], description: 'Sub-mode to start in (default select — the user picks a colour or Pen to draw).' },
      color: { type: 'color', description: 'Draw colour for strokes + text ([r,g,b] 0..1 or "#rrggbb").' },
      width: { type: 'number', min: 0.5, max: 64, description: 'Pen line width in px (presets 2 / 4 / 7 / 12).' },
      fontSize: { type: 'number', min: 4, max: 256, description: 'Text size in px (presets 16 / 22 / 32 / 48).' },
    },
    open: (prefill, ctx) => openAnnotateWithPrefill(prefill, ctx),
    getState: () => (isAnyActive() ? {
      mode: isPenActive() ? 'pen' : isTextActive() ? 'text' : 'select',
      color: getPenColor(), width: getPenWidth(), fontSize: getTextFontSize(),
    } : null),
    isOpen: isAnyActive,
    close: closeAnnotatePanel,
  });

  onStrokesChange(updateCountBadge);
  onRedoChange(updateRedoButton);
  onPenActiveChange(updatePanelState);
  onTextActiveChange(updatePanelState);
  onSelectActiveChange(updatePanelState);
  onSelectionChange(updateSelectionInfo);
  onAnnotateStyleChange(onStyleChanged);
  onAnnotationViewsChange(renderHistory);
  onStrokesChange(updateSaveButton);
  updateStyleUI();
  renderHistory();
  updateCountBadge();
  updatePanelState();
  updateSelectionInfo(null);
  updateRedoButton();
}

/** Open Annotate (if closed) in the requested sub-mode with the prefill's
 *  colour / width / font size staged — the user draws. */
function openAnnotateWithPrefill(p: Record<string, unknown> | undefined, ctx: ToolOpenContext): ToolOpenResult {
  const pre = p ?? {};
  const mode = (pre.mode as 'pen' | 'text' | 'select' | undefined) ?? (isAnyActive() ? undefined : 'select');
  if (mode === 'pen') selectPenSubMode();
  else if (mode === 'text') selectTextSubMode();
  else if (mode === 'select') selectSelectSubMode();
  setToolNote(annotateContentEl, ctx.note, ctx.source);
  if (pre.color !== undefined) {
    const c = pre.color as [number, number, number];
    setPenColor(c); setTextColor(c);
    syncColorUI?.(c);
  }
  if (pre.width !== undefined) { setPenWidth(pre.width as number); syncWidthUI?.(); }
  if (pre.fontSize !== undefined) { setTextFontSize(pre.fontSize as number); syncFontUI?.(); }
  return { applied: pre, ignored: [] };
}

function isAnyActive(): boolean {
  return isPenActive() || isTextActive() || isSelectActive();
}

function toggleAnnotateMode(): void {
  setToolNote(annotateContentEl, null);
  if (isAnyActive()) {
    deactivatePen();
    deactivateText();
    deactivateSelect();
    // No sub-mode active: tear down the session plane so the next activation
    // captures a fresh camera state and shows a fresh outline.
    hidePlaneOutline();
    endSessionPlane();
  } else {
    // Annotate opens at rest in Select: the view behaves as it did before
    // the panel opened; Pen/Text (or picking a colour) start drawing.
    selectSelectSubMode();
  }
}

/** Before Annotate opens (not on a sub-mode switch): in Snapshot style, enter
 *  the draft layer and, when unsaved drafts are waiting, snap the camera back
 *  to the frame they were drawn on so they line up again. */
function prepareOpen(): void {
  if (isAnyActive()) return;
  if (getAnnotateStyle() !== 'snapshot') return;
  setDraftScope(true);
  const draft = getDrafts()[0];
  if (draft) restoreCameraView(draft.camera);
}

function selectPenSubMode(): void {
  if (isPenActive()) return;
  prepareOpen();
  activatePen();
}

function selectTextSubMode(): void {
  if (isTextActive()) return;
  prepareOpen();
  activateText();
}

function selectSelectSubMode(): void {
  if (isSelectActive()) return;
  prepareOpen();
  activateSelect();
}

function onStyleChanged(): void {
  if (isAnyActive()) setDraftScope(getAnnotateStyle() === 'snapshot');
  updateStyleUI();
}

function updateStyleUI(): void {
  const snapshot = getAnnotateStyle() === 'snapshot';
  if (snapshotTabBtn) snapshotTabBtn.className = snapshot ? tabActiveClass : tabInactiveClass;
  if (floatingTabBtn) floatingTabBtn.className = snapshot ? tabInactiveClass : tabActiveClass;
  if (styleInfo) {
    styleInfo.textContent = snapshot
      ? 'Snapshot: line up the view, then pick a colour or Pen to mark it up (the view holds still while you draw; Esc returns to Select). Save view keeps the frame, its exact camera and your marks in the history below. Attach a view to the AI chat when you are ready.'
      : 'Floating: marks stay pinned in space, saved with this version and drawn in every render. Save view also records this angle in the history.';
  }
  updateSaveButton();
}

function updateSaveButton(): void {
  if (!saveViewBtn) return;
  saveViewBtn.textContent = getAnnotateStyle() === 'snapshot' && getDrafts().length === 0
    ? '\u{1F4F7} Save view (no marks)'
    : '\u{1F4F7} Save view';
}

async function saveView(): Promise<void> {
  if (!saveViewBtn) return;
  saveViewBtn.disabled = true;
  try {
    const r = await captureAnnotationView({ title: viewTitleInput?.value });
    if ('error' in r) { showToast(r.error, { variant: 'warn', source: 'app' }); return; }
    if (viewTitleInput) viewTitleInput.value = '';
    showToast(`Saved "${r.title}" to the annotation history`, { variant: 'success', source: 'app' });
  } catch (err) {
    showToast(`Could not save the view: ${(err as Error)?.message ?? String(err)}`, { variant: 'warn', source: 'app' });
  } finally {
    saveViewBtn.disabled = false;
    updateSaveButton();
  }
}

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}

const historyBtnClass = `${BUTTON_SMALL_SECONDARY} min-h-[44px] md:min-h-0 whitespace-nowrap`;
const historyDangerClass = `${BUTTON_SMALL_DANGER} border border-red-800/60 whitespace-nowrap`;

function renderHistory(): void {
  if (!historyList || !historyHeader) return;
  const views = [...getAnnotationViews()].reverse();
  historyHeader.textContent = `History (${views.length})`;
  historyList.replaceChildren();
  if (views.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-[10px] text-zinc-500 py-1';
    empty.textContent = 'No saved views yet.';
    historyList.appendChild(empty);
    return;
  }
  for (const v of views) historyList.appendChild(historyRow(v));
}

function historyRow(v: AnnotationView): HTMLElement {
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-start py-1.5 border-b border-zinc-700/60 last:border-b-0';
  row.dataset.viewId = v.id;

  const thumb = document.createElement('img');
  thumb.src = v.image;
  thumb.alt = v.title;
  thumb.className = 'w-16 h-11 shrink-0 rounded object-cover border border-zinc-600 cursor-pointer hover:border-zinc-300';
  thumb.title = 'Snap the camera to this view';
  thumb.addEventListener('click', () => restoreAnnotationViewCamera(v));
  row.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'min-w-0 flex-1';
  const title = document.createElement('div');
  title.className = 'text-[11px] text-zinc-200 truncate';
  title.textContent = v.title;
  body.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'text-[10px] text-zinc-500 truncate';
  meta.textContent = `${describeViewHits(v)} · ${formatAgo(v.createdAt)}${v.attachedAt ? ' · attached' : ''}`;
  meta.title = meta.textContent;
  body.appendChild(meta);

  const btns = document.createElement('div');
  btns.className = 'flex flex-wrap items-center gap-1 mt-1';
  const attach = document.createElement('button');
  attach.className = historyBtnClass;
  attach.textContent = '\u{1F4CE} Attach to AI';
  attach.title = 'Add this view (image + summary) to the AI chat input — nothing is sent until you press Send';
  attach.addEventListener('click', async () => {
    const r = await attachAnnotationViewToChat(v);
    if ('error' in r) showToast(r.error, { variant: 'warn', source: 'app' });
    else showToast(`Attached "${v.title}" to the AI chat`, { variant: 'success', source: 'app' });
  });
  btns.appendChild(attach);

  const view = document.createElement('button');
  view.className = historyBtnClass;
  view.textContent = 'View';
  view.title = 'Snap the camera to this view';
  view.addEventListener('click', () => restoreAnnotationViewCamera(v));
  btns.appendChild(view);

  const del = document.createElement('button');
  del.className = historyBtnClass;
  del.textContent = 'Delete';
  del.title = 'Delete this view from the history';
  // Two-step delete: the first click arms "Confirm" for a few seconds (and
  // disarms on blur), so a stray later click can't delete.
  let disarmTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (disarmTimer) clearTimeout(disarmTimer);
    disarmTimer = null;
    del.textContent = 'Delete';
    del.className = historyBtnClass;
  };
  del.addEventListener('blur', disarm);
  del.addEventListener('click', () => {
    if (!disarmTimer) {
      del.textContent = 'Confirm';
      del.className = historyDangerClass;
      disarmTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    deleteAnnotationView(v.id).catch(err => showToast(`Could not delete the view: ${(err as Error)?.message ?? String(err)}`, { variant: 'warn', source: 'app' }));
  });
  btns.appendChild(del);
  body.appendChild(btns);
  row.appendChild(body);
  return row;
}

const annotateRegistryEntry = { close(): void { closeAnnotatePanel(); } };

/** Esc steps back one level: Pen/Text → Select; Select (nothing selected) →
 *  close Annotate. Keys typed into a field (the text-label input, the view
 *  title) are left to that field — its own Esc cancels the edit first. */
function onAnnotateEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (isPenActive() || isTextActive()) { selectSelectSubMode(); return; }
  if (isSelectActive() && getSelectedId()) return; // select mode's own Esc deselects
  closeAnnotatePanel();
}

/** Picking a colour from Select means "I want to draw": jump to Pen. Text
 *  keeps its mode (the colour applies to the next label). */
function drawWithPickedColor(): void {
  if (!isPenActive() && !isTextActive()) selectPenSubMode();
}

function updatePanelState(): void {
  if (!annotateBtn) return;
  const open = isAnyActive();
  const wasOpen = pickerPanel ? !pickerPanel.classList.contains('hidden') : false;
  annotateBtn.className = open ? activeBtnClass : inactiveBtnClass;
  // Drafts are only in scope while Annotate is open in Snapshot style. A
  // sub-mode switch passes through a moment with no mode active (the old one
  // deactivates before the new one activates), so leaving the draft layer is
  // deferred to a microtask and skipped if Annotate reopened by then —
  // otherwise every switch would flicker the overlay and drop redo.
  if (open) setDraftScope(getAnnotateStyle() === 'snapshot');
  else queueMicrotask(() => { if (!isAnyActive()) setDraftScope(false); });
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
      setToolNote(annotateContentEl, null);
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
  // Fixed width: the panel sits over the viewport, so it must not grow wide
  // enough to cover the frame being marked up.
  panel.style.width = '288px';
  panel.style.maxWidth = 'calc(100vw - 32px)';

  // Header: drag handle + title + × close button (shared tool-panel chrome).
  const header = createToolPanelHeader('✏️ Annotate', () => { toggleAnnotateMode(); }, 'Close annotate menu');
  panel.appendChild(header);
  attachViewportPanelDrag(header, panel);

  // Padded content beneath the header.
  const content = document.createElement('div');
  content.className = 'p-2.5';
  panel.appendChild(content);
  annotateContentEl = content;

  // Style: Snapshot (mark up a frozen frame, save it as a view) or Floating
  // (marks pinned in space, saved per version).
  const styleRow = document.createElement('div');
  styleRow.className = 'flex items-center gap-1.5 mb-2';
  const mkStyleBtn = (label: string, value: AnnotateStyle, tip: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = tabInactiveClass;
    b.textContent = label;
    b.title = tip;
    b.dataset.annotateStyle = value;
    b.addEventListener('click', () => setAnnotateStyle(value));
    styleRow.appendChild(b);
    return b;
  };
  snapshotTabBtn = mkStyleBtn('\u{1F4F7} Snapshot', 'snapshot', 'Mark up the current frame; save it with its camera angle as a view the AI can look at');
  floatingTabBtn = mkStyleBtn('\u{1FAE7} Floating', 'floating', 'Marks float on a plane in space and are saved with the version');
  content.appendChild(styleRow);

  // Info banner — explains the active style.
  styleInfo = document.createElement('div');
  styleInfo.className = 'mb-2 p-2 rounded bg-blue-500/10 border border-blue-400/30 text-[10px] text-blue-200 leading-snug';
  content.appendChild(styleInfo);

  // Sub-mode tabs
  const tabsRow = document.createElement('div');
  tabsRow.className = 'flex items-center gap-1.5 mb-2';

  selectTabBtn = document.createElement('button');
  selectTabBtn.className = tabInactiveClass;
  selectTabBtn.textContent = '\u2196 Select';
  selectTabBtn.title = 'Look around as usual; click an annotation to select it, drag to move, Delete to remove';
  selectTabBtn.addEventListener('click', selectSelectSubMode);
  tabsRow.appendChild(selectTabBtn);

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
      custom.setHex(rgbToHex(color)); // keep the custom swatch a truthful preview
      drawWithPickedColor();
    });
    grid.appendChild(swatch);
  }
  const first = grid.children[0] as HTMLElement;
  if (first) first.classList.add('border-white/80', 'ring-1', 'ring-white/30');
  content.appendChild(grid);

  // Custom color
  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-1.5 mb-2';
  const custom = createColorSwatch({
    initialHex: rgbToHex(PRESET_COLORS[0]),
    title: 'Custom color',
    modalTitle: 'Annotation colour',
    className: 'w-6 h-6 shrink-0 rounded cursor-pointer border border-zinc-500 hover:border-white/70 transition-colors',
    onPick: (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      setPenColor([r, g, b]);
      setTextColor([r, g, b]);
      for (const child of Array.from(grid.children)) {
        (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
      }
      drawWithPickedColor();
    },
  });
  syncColorUI = (c) => {
    custom.setHex(rgbToHex(c));
    const i = PRESET_COLORS.findIndex(p => p.every((v, k) => Math.abs(v - c[k]) < 1e-3));
    for (const child of Array.from(grid.children)) {
      (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
    }
    if (i >= 0) (grid.children[i] as HTMLElement).classList.add('border-white/80', 'ring-1', 'ring-white/30');
  };
  const colorInput = custom.el;
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
  syncWidthUI = () => {
    const i = PRESET_WIDTHS.findIndex(w => w.value === getPenWidth());
    if (i >= 0) markActiveSizeButton(widthButtonRefs, widthButtonRefs[i]);
    else for (const b of widthButtonRefs) { b.classList.remove('bg-zinc-500/60', 'ring-1', 'ring-white/30'); b.classList.add('bg-zinc-700/60'); }
  };
  syncWidthUI();
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
  syncFontUI = () => {
    const i = PRESET_FONT_SIZES.findIndex(f => f.value === getTextFontSize());
    if (i >= 0) markActiveSizeButton(fontButtonRefs, fontButtonRefs[i]);
    else for (const b of fontButtonRefs) { b.classList.remove('bg-zinc-500/60', 'ring-1', 'ring-white/30'); b.classList.add('bg-zinc-700/60'); }
  };
  syncFontUI();
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

  // Save view: title + capture button.
  const saveRow = document.createElement('div');
  saveRow.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700';
  viewTitleInput = document.createElement('input');
  viewTitleInput.type = 'text';
  viewTitleInput.placeholder = 'View title (optional)';
  viewTitleInput.className = 'min-w-0 flex-1 px-2 py-1 rounded text-[11px] bg-zinc-900/70 border border-zinc-600 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-400';
  viewTitleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void saveView(); });
  saveRow.appendChild(viewTitleInput);
  saveViewBtn = document.createElement('button');
  saveViewBtn.id = 'annotate-save-view';
  saveViewBtn.className = `${BUTTON_SMALL_PRIMARY} whitespace-nowrap`;
  saveViewBtn.title = 'Save this frame, its exact camera and your marks to the annotation history';
  saveViewBtn.addEventListener('click', () => { void saveView(); });
  saveRow.appendChild(saveViewBtn);
  content.appendChild(saveRow);

  // History of saved views, newest first.
  historyHeader = document.createElement('div');
  historyHeader.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mt-2 mb-1 font-medium';
  content.appendChild(historyHeader);
  historyList = document.createElement('div');
  historyList.id = 'annotate-view-history';
  historyList.className = 'max-h-56 overflow-y-auto pr-1';
  content.appendChild(historyList);

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

export type AnnotateSubMode = 'pen' | 'text' | 'select';

/** The active annotate sub-mode, or null when Annotate is closed. */
export function getAnnotateSubMode(): AnnotateSubMode | null {
  if (isPenActive()) return 'pen';
  if (isTextActive()) return 'text';
  if (isSelectActive()) return 'select';
  return null;
}

/** Open Annotate in a sub-mode (the panel's Pen / Text / Select tabs), or
 *  close it with null — the same transitions the toolbar button and tabs make,
 *  so the panel, plane outline and exclusive-mode handoff all follow. */
export function setAnnotateSubMode(mode: AnnotateSubMode | null): void {
  if (mode === null) { closeAnnotatePanel(); return; }
  if (mode === 'pen') selectPenSubMode();
  else if (mode === 'text') selectTextSubMode();
  else selectSelectSubMode();
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
