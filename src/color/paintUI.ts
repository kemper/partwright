// Paint mode UI — button toggle, color picker, region count badge, tool
// selection (bucket / brush / slab), and undo/redo/hide/clear actions.

import {
  activate,
  deactivate,
  isActive,
  setColor,
  getColor,
  setSlot,
  getSlotId,
  setTool,
  getTool,
  setBucketTolerance,
  getBucketTolerance,
  setBucketColorTolerance,
  getBucketColorTolerance,
  setBucketMode,
  getBucketMode,
  setReplaceSourceColor,
  getReplaceSourceColor,
  onReplaceSourceColorChange,
  setBrushRadius,
  getBrushRadius,
  setBrushShape,
  getBrushShape,
  setBrushSmooth,
  isBrushSmooth,
  setBrushSmoothDivisor,
  getBrushSmoothDivisor,
  setBrushPaintDepth,
  getBrushPaintDepth,
  setBrushWrapAngle,
  getBrushWrapAngle,
  WRAP_ANGLE_MIN,
  WRAP_ANGLE_MAX,
  setBrushSurface,
  getBrushSurface,
  setBrushSpray,
  isBrushSpray,
  setBrushSprayStrength,
  getBrushSprayStrength,
  setBrushSpraySoftness,
  getBrushSpraySoftness,
  SMOOTH_DIVISOR_MIN,
  SMOOTH_DIVISOR_MAX,
  setShapeSmooth,
  isShapeSmooth,
  setShapeSmoothResolution,
  getShapeSmoothResolution,
  setSlabAxis,
  getSlabAxis,
  previewTriangles,
  refreshBucketPreview,
  getCurrentMesh as getPaintMesh,
  type PaintTool,
  type BrushShape,
} from './paintMode';
import {
  getActivePalette,
  getPaletteCapacity,
  isPaletteConstrained,
  onPaletteChange,
} from './palette';
import { usedSlotIds } from './regions';
import { openPaletteManager } from './paletteManager';
import {
  getRegions,
  onChange as onRegionsChange,
  onRedoChange,
  onVisibilityChange,
  onClearSnapshotChange,
  isVisible as isPaintVisible,
  setVisible as setPaintVisible,
  removeLastRegion,
  redoLastRegion,
  canRedoRegion,
  canUndoClear,
  undoClear,
  clearRegions,
  removeRegion,
  setRegionVisibility,
  updateRegionColor,
  addRegion,
  replaceRegionColors,
  getDistinctRegionColors,
} from './regions';
import { getPaintLabels, onPaintLabelsChange, type LabelInfo } from './labels';
import { forceDeactivate as forceDeactivateAnnotate } from '../annotations/annotateUI';
import { forceDeactivate as forceDeactivateAnnotateText } from '../annotations/textMode';
import { forceDeactivate as forceDeactivateAnnotateSelect } from '../annotations/selectMode';
import { setBoxMode, getBoxMode, setBox, commitBox, onBoxChange, setShapeType, getShapeType, getShapeVisible, setShapeVisible, onShapeVisibilityChange, type BoxMode, type ShapeType } from './boxDrag';
import { forceDeactivate as closeSimplifyMenu } from '../ui/simplifyUI';
import { forceDeactivate as closePrintToolsMenu } from '../ui/printToolsUI';
import { openViewportPanel, closeViewportPanel } from '../ui/viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from '../ui/viewportPanelDrag';
import { registerExclusiveMode, deactivateMode } from '../ui/modeExclusion';
import { viewportToolsMount } from '../ui/popoverMenu';
import { createToolPanelHeader, TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from '../ui/toolPanel';

let paintBtn: HTMLButtonElement | null = null;
let pickerPanel: HTMLElement | null = null;
let regionCountBadge: HTMLElement | null = null;
let visibilityBtn: HTMLButtonElement | null = null;
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let undoClearBtn: HTMLButtonElement | null = null;
let paintShapeBtn: HTMLButtonElement | null = null; // "Paint inside shape" action button
let toolButtons: Partial<Record<PaintTool, HTMLButtonElement>> = {};
let bucketControls: HTMLElement | null = null;
let brushControls: HTMLElement | null = null;
let slabControls: HTMLElement | null = null;
let boxControls: HTMLElement | null = null;
let replaceControls: HTMLElement | null = null;
// Shape-smoothing controls appear in both the slab and box panels but share one
// state; re-sync each instance's display on tool switch so neither goes stale.
const shapeSmoothSyncs: (() => void)[] = [];

/** Initialize the paint UI inside the clip-controls overlay area. */
export function initPaintUI(controlsContainer: HTMLElement): void {
  paintBtn = document.createElement('button');
  paintBtn.id = 'paint-toggle';
  paintBtn.className = TOOL_TOGGLE_IDLE;
  paintBtn.textContent = '\uD83C\uDFA8 Paint';
  paintBtn.title = 'Paint color regions on model faces';

  regionCountBadge = document.createElement('span');
  regionCountBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white leading-none';
  paintBtn.appendChild(regionCountBadge);

  paintBtn.addEventListener('click', togglePaintMode);

  const toolsMount = viewportToolsMount(controlsContainer);
  toolsMount.appendChild(paintBtn);

  // Standalone palette manager entry point — edit filament slots without
  // entering paint mode. Edits propagate to the paint swatches and relief.
  const paletteBtn = document.createElement('button');
  paletteBtn.id = 'palette-manager-toggle';
  paletteBtn.className = TOOL_TOGGLE_IDLE;
  paletteBtn.textContent = '🧵 Palette';
  paletteBtn.title = 'Manage the filament palette (slots, colours, capacity)';
  paletteBtn.addEventListener('click', () => openPaletteManager());
  toolsMount.insertBefore(paletteBtn, paintBtn);

  pickerPanel = createPickerPanel();
  // Anchor the panel to the positioned viewport pane (the toolbar's parent)
  // rather than the small top-right toolbar box, so the mobile bottom-sheet
  // layout measures against the full viewport. The viewport pane owns the
  // wheel-forwarder, so wheel-to-zoom still passes through the panel whenever it
  // isn't actively scrolling.
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(pickerPanel);

  onRegionsChange(() => {
    updateBadge();
    updateUndoButton();
  });
  onRedoChange(updateRedoButton);
  onVisibilityChange(updateVisibilityButton);
  onClearSnapshotChange(updateUndoClearButton);
  updateBadge();
  updateUndoButton();
  updateRedoButton();
  updateVisibilityButton();
  updateUndoClearButton();
}

const paintRegistryEntry = { close(): void { if (isActive()) togglePaintMode(); } };

function onPaintEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  togglePaintMode();
}

function togglePaintMode(): void {
  if (isActive()) {
    deactivate();
    updateButtonState(false);
    closeViewportPanel(paintRegistryEntry);
    document.removeEventListener('keydown', onPaintEscape);
    pickerPanel?.classList.add('hidden');
  } else {
    forceDeactivateAnnotate();
    forceDeactivateAnnotateText();
    forceDeactivateAnnotateSelect();
    closeSimplifyMenu();
    closePrintToolsMenu();
    deactivateMode('imagePaint');
    deactivateMode('voxelStudio');
    activate();
    updateButtonState(true);
    if (pickerPanel) setInitialPanelPosition(pickerPanel);
    openViewportPanel(paintRegistryEntry);
    document.addEventListener('keydown', onPaintEscape);
    pickerPanel?.classList.remove('hidden');
    syncToolPanels();
  }
}

function updateButtonState(active: boolean): void {
  if (!paintBtn) return;
  paintBtn.className = active ? TOOL_TOGGLE_ACTIVE : TOOL_TOGGLE_IDLE;
}

/** Build the palette section: the slot swatch grid, an over-budget badge, the
 *  custom-colour picker (hidden when the palette is constrained), and a
 *  collapsible inline palette editor. */
function createPaletteSection(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mb-2';

  // Header: "Palette" + over-budget badge + edit toggle.
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between mb-1.5';
  const title = document.createElement('div');
  title.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  title.textContent = 'Palette';
  head.appendChild(title);

  const headRight = document.createElement('div');
  headRight.className = 'flex items-center gap-1.5';
  const budget = document.createElement('span');
  budget.className = 'hidden px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40';
  headRight.appendChild(budget);
  const manageBtn = document.createElement('button');
  manageBtn.className = 'text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors';
  manageBtn.textContent = 'Manage…';
  manageBtn.title = 'Open the filament palette manager (add, recolour, reorder slots + capacity)';
  manageBtn.addEventListener('click', () => openPaletteManager());
  headRight.appendChild(manageBtn);
  head.appendChild(headRight);
  wrap.appendChild(head);

  // Swatch grid (one swatch per palette slot).
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-4 gap-1.5 mb-2';
  wrap.appendChild(grid);

  // Custom (ad-hoc, unslotted) colour — hidden when the palette is constrained.
  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-1.5';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent';
  colorInput.title = 'Custom color (unslotted)';
  colorInput.addEventListener('input', () => {
    const hex = colorInput.value;
    setColor([
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ]);
    renderSwatches(); // drop the active-slot ring — we're now on an ad-hoc colour
  });
  const customLabel = document.createElement('span');
  customLabel.className = 'text-[10px] text-zinc-500';
  customLabel.textContent = 'Custom';
  customRow.appendChild(colorInput);
  customRow.appendChild(customLabel);
  wrap.appendChild(customRow);

  function renderSwatches(): void {
    grid.replaceChildren();
    const slots = getActivePalette().slots;
    const activeId = getSlotId();
    slots.forEach((slot, i) => {
      const swatch = document.createElement('button');
      swatch.className = 'w-6 h-6 rounded border-2 border-transparent hover:border-white/50 transition-colors';
      swatch.style.backgroundColor = slot.hex;
      swatch.title = `Slot ${i + 1}: ${slot.name} (${slot.hex})`;
      if (slot.id === activeId) swatch.classList.add('border-white/80', 'ring-1', 'ring-white/30');
      swatch.addEventListener('click', () => {
        setSlot(slot.id);
        renderSwatches();
      });
      grid.appendChild(swatch);
    });
  }

  function renderBudget(): void {
    const used = usedSlotIds().size;
    const cap = getPaletteCapacity();
    if (used > cap) {
      budget.textContent = `${used}/${cap} slots`;
      budget.title = `This model uses ${used} filament colours but the palette capacity is ${cap}. Your printer may not have enough slots.`;
      budget.classList.remove('hidden');
    } else {
      budget.classList.add('hidden');
    }
  }

  function renderConstrain(): void {
    customRow.classList.toggle('hidden', isPaletteConstrained());
  }

  // Don't pre-select a slot: that would override the default paint colour with
  // the first slot's (white), surprising the user and any code relying on the
  // red default. Slots are opt-in — the swatch grid shows no active ring until
  // the user picks one, and the custom colour stays the unslotted default.
  renderSwatches();
  renderBudget();
  renderConstrain();
  onPaletteChange(() => { renderSwatches(); renderBudget(); renderConstrain(); });
  onRegionsChange(() => { renderBudget(); renderSwatches(); });

  return wrap;
}

function updateBadge(): void {
  if (!regionCountBadge) return;
  const count = getRegions().length;
  if (count > 0) {
    regionCountBadge.textContent = String(count);
    regionCountBadge.classList.remove('hidden');
  } else {
    regionCountBadge.classList.add('hidden');
  }
}

function createPickerPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'paint-picker-panel';
  // Responsive shell. On mobile it's a bottom sheet docked to the viewport's
  // bottom edge, so the model stays visible above it and it never covers the top
  // toolbar (including the Paint toggle). On desktop it's a compact floating
  // panel pinned top-right. Either way it's a flex column with a sticky header
  // and footer around one scrollable middle, so the action row stays reachable
  // no matter how long the region list grows.
  panel.className = 'hidden z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl absolute rounded-lg w-60 max-h-[calc(100%-3.5rem)]';

  // === Header: drag handle + title + \u00D7 close button (shared tool-panel chrome) ===
  const header = createToolPanelHeader('\uD83C\uDFA8 Paint', () => { togglePaintMode(); }, 'Close paint menu');
  panel.appendChild(header);
  attachViewportPanelDrag(header, panel);

  // === Scrollable content ===
  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5';
  panel.appendChild(content);

  // === Tool selector ===
  const toolTitle = document.createElement('div');
  toolTitle.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  toolTitle.textContent = 'Tool';
  content.appendChild(toolTitle);

  const toolRow = document.createElement('div');
  toolRow.className = 'grid grid-cols-2 gap-1 mb-2.5';
  toolRow.appendChild(createToolButton('bucket', '\u{1FAA3} Bucket', 'Flood-fill connected faces by color or geometry'));
  toolRow.appendChild(createToolButton('brush', '\u{1F58C}\uFE0F Brush', 'Paint individual triangles (drag to paint)'));
  toolRow.appendChild(createToolButton('slab', '\u{1F9F1} Slab', 'Paint all faces inside an axis-aligned range'));
  toolRow.appendChild(createToolButton('box', '\u25C6 Shape', 'Paint everything inside a positionable, rotatable, scalable 3D shape (box, sphere, cylinder, or cone)'));
  toolRow.appendChild(createToolButton('replace', '\u{1F504} Replace', 'Replace one color with another across all matching regions (click mesh to pick source, then Replace all)'));
  content.appendChild(toolRow);

  // === Palette (filament slots) ===
  // The swatch grid is driven by the shared colour palette, so each swatch maps
  // to a filament/AMS slot. Painting with a swatch attributes the region to that
  // slot, so recolouring a slot recolours every region on it and export can group
  // by slot order. The custom picker still allows ad-hoc (unslotted) colour
  // unless the palette is constrained.
  const paletteSection = createPaletteSection();
  content.appendChild(paletteSection);

  // === Bucket tool controls (tolerance slider + number input) ===
  bucketControls = createBucketControls();
  content.appendChild(bucketControls);

  // === Brush tool controls (radius slider + number input) ===
  brushControls = createBrushControls();
  content.appendChild(brushControls);

  // === Slab tool controls ===
  slabControls = createSlabControls();
  content.appendChild(slabControls);

  // === Box tool controls ===
  boxControls = createBoxControls();
  content.appendChild(boxControls);

  // === Replace tool controls ===
  replaceControls = createReplaceControls();
  content.appendChild(replaceControls);

  // === Labels list ===
  // Surfaces the named features `api.label(shape, name)` registered in the
  // current run. Hovering a row highlights the label's triangles on the model
  // (same translucent overlay the regions list uses); clicking paints them
  // with the active color via a byLabel descriptor — identical to what
  // `partwright.paintByLabel` produces from a script.
  const labelList = document.createElement('div');
  labelList.id = 'paint-label-list';
  labelList.className = 'mt-2 border-t border-zinc-700 pt-2';
  content.appendChild(labelList);
  updateLabelList(labelList);
  onPaintLabelsChange(() => updateLabelList(labelList));
  onRegionsChange(() => updateLabelList(labelList));

  // === Region list ===
  // Flows inside the single scroll area; the sticky footer keeps the actions
  // reachable, so it no longer needs its own capped inner scrollbar.
  const regionList = document.createElement('div');
  regionList.id = 'paint-region-list';
  regionList.className = 'mt-2 border-t border-zinc-700 pt-2';
  content.appendChild(regionList);

  onRegionsChange(() => updateRegionList(regionList));

  // === Footer (sticky): region actions stay reachable no matter how far the
  // scrollable content above is scrolled ===
  const footer = document.createElement('div');
  footer.className = 'shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-t border-zinc-700 bg-zinc-800/95 flex-wrap';

  visibilityBtn = document.createElement('button');
  visibilityBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  visibilityBtn.title = 'Toggle all paint region visibility in viewport (exports keep colors regardless)';
  visibilityBtn.addEventListener('click', () => { setPaintVisible(!isPaintVisible()); });
  footer.appendChild(visibilityBtn);

  undoBtn = document.createElement('button');
  undoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Remove the most recent paint region';
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', () => { removeLastRegion(); });
  footer.appendChild(undoBtn);

  redoBtn = document.createElement('button');
  redoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Restore the most recently undone paint region';
  redoBtn.disabled = true;
  redoBtn.addEventListener('click', () => { redoLastRegion(); });
  footer.appendChild(redoBtn);

  undoClearBtn = document.createElement('button');
  undoClearBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  undoClearBtn.textContent = 'Undo clear';
  undoClearBtn.title = 'Restore all regions removed by the last Clear (only available until the next paint)';
  undoClearBtn.disabled = true;
  undoClearBtn.addEventListener('click', () => { undoClear(); });
  footer.appendChild(undoClearBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-2 py-1 rounded text-[10px] bg-red-700/60 text-red-200 hover:bg-red-600/60 transition-colors';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Remove all paint regions';
  clearBtn.addEventListener('click', () => { clearRegions(); });
  footer.appendChild(clearBtn);

  panel.appendChild(footer);

  return panel;
}

function createToolButton(tool: PaintTool, label: string, tooltip: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = toolButtonClass(tool === getTool());
  btn.textContent = label;
  btn.title = tooltip;
  btn.addEventListener('click', () => {
    setTool(tool);
    syncToolPanels();
  });
  toolButtons[tool] = btn;
  return btn;
}

function toolButtonClass(active: boolean): string {
  if (active) {
    return 'px-1.5 py-1 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center';
  }
  return 'px-1.5 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

function syncToolPanels(): void {
  const tool = getTool();
  for (const [t, btn] of Object.entries(toolButtons)) {
    if (btn) btn.className = toolButtonClass(t === tool);
  }
  if (bucketControls) bucketControls.classList.toggle('hidden', tool !== 'bucket');
  if (brushControls) brushControls.classList.toggle('hidden', tool !== 'brush');
  if (slabControls) slabControls.classList.toggle('hidden', tool !== 'slab');
  if (boxControls) boxControls.classList.toggle('hidden', tool !== 'box');
  if (replaceControls) replaceControls.classList.toggle('hidden', tool !== 'replace');
  for (const sync of shapeSmoothSyncs) sync();
}

function createBucketControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700';

  const headerRow = document.createElement('div');
  headerRow.className = 'flex items-center justify-between mb-1.5';
  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  label.textContent = 'Bucket tolerance';
  headerRow.appendChild(label);

  // Mode toggle: Color | Geometry
  const modeRow = document.createElement('div');
  modeRow.className = 'flex gap-0.5';
  const modeBtnClass = (active: boolean) =>
    active
      ? 'px-1.5 py-0.5 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors'
      : 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-700/40 text-zinc-400 hover:bg-zinc-600/60 border border-transparent transition-colors';

  const colorModeBtn = document.createElement('button');
  colorModeBtn.textContent = 'Color';
  colorModeBtn.title = 'Flood-fill by color similarity (magic-wand style)';
  const geomModeBtn = document.createElement('button');
  geomModeBtn.textContent = 'Geometry';
  geomModeBtn.title = 'Flood-fill by face angle (original coplanar style)';

  const syncModeBtns = (): void => {
    const m = getBucketMode();
    colorModeBtn.className = modeBtnClass(m === 'color');
    geomModeBtn.className = modeBtnClass(m === 'geometry');
    colorPanel.classList.toggle('hidden', m !== 'color');
    geomPanel.classList.toggle('hidden', m !== 'geometry');
  };

  colorModeBtn.addEventListener('click', () => { setBucketMode('color'); syncModeBtns(); refreshBucketPreview(); });
  geomModeBtn.addEventListener('click', () => { setBucketMode('geometry'); syncModeBtns(); refreshBucketPreview(); });
  modeRow.appendChild(colorModeBtn);
  modeRow.appendChild(geomModeBtn);
  headerRow.appendChild(modeRow);
  wrap.appendChild(headerRow);

  // \u2500\u2500 Color-mode sub-panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const colorPanel = document.createElement('div');

  const colorRow = document.createElement('div');
  colorRow.className = 'flex items-center gap-2';

  const colorSlider = document.createElement('input');
  colorSlider.type = 'range';
  colorSlider.min = '0';
  colorSlider.max = '100';
  colorSlider.step = '1';
  colorSlider.value = String(Math.round(getBucketColorTolerance() * 100));
  colorSlider.className = 'flex-1 accent-blue-500 min-w-0';
  colorSlider.title = 'Color distance tolerance (0 = exact match, 100 = fill entire connected mesh)';

  const colorInput = document.createElement('input');
  colorInput.type = 'number';
  colorInput.min = '0';
  colorInput.max = '100';
  colorInput.step = '1';
  colorInput.value = String(Math.round(getBucketColorTolerance() * 100));
  colorInput.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  colorInput.title = 'Color tolerance (0\u2013100)';

  const colorUnit = document.createElement('span');
  colorUnit.className = 'text-[10px] text-zinc-500';
  colorUnit.textContent = '%';

  colorSlider.addEventListener('input', () => {
    const tol = parseInt(colorSlider.value, 10) / 100;
    setBucketColorTolerance(tol);
    colorInput.value = String(Math.round(tol * 100));
    refreshBucketPreview();
  });
  const applyColorPct = (): void => {
    const raw = parseFloat(colorInput.value);
    if (!Number.isFinite(raw)) { colorInput.value = String(Math.round(getBucketColorTolerance() * 100)); return; }
    const pct = Math.max(0, Math.min(100, Math.round(raw)));
    setBucketColorTolerance(pct / 100);
    colorSlider.value = String(pct);
    colorInput.value = String(pct);
    refreshBucketPreview();
  };
  colorInput.addEventListener('change', applyColorPct);
  colorInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyColorPct(); colorInput.blur(); } });

  colorRow.appendChild(colorSlider);
  colorRow.appendChild(colorInput);
  colorRow.appendChild(colorUnit);
  colorPanel.appendChild(colorRow);

  const colorHelp = document.createElement('div');
  colorHelp.className = 'text-[10px] text-zinc-500 mt-1';
  colorHelp.textContent = 'Exact match \u2190\u2014\u2014\u2192 Any color';
  colorPanel.appendChild(colorHelp);
  wrap.appendChild(colorPanel);

  // \u2500\u2500 Geometry-mode sub-panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const geomPanel = document.createElement('div');

  const geomRow = document.createElement('div');
  geomRow.className = 'flex items-center gap-2';

  const geomSlider = document.createElement('input');
  geomSlider.type = 'range';
  geomSlider.min = '0';
  geomSlider.max = '100';
  geomSlider.step = '1';
  geomSlider.value = String(toleranceToSliderPct(getBucketTolerance()));
  geomSlider.className = 'flex-1 accent-blue-500 min-w-0';
  geomSlider.title = 'Maximum bend angle (0\u00b0\u2013180\u00b0) between adjacent faces the flood-fill is allowed to cross';

  const geomInput = document.createElement('input');
  geomInput.type = 'number';
  geomInput.min = '0';
  geomInput.max = '180';
  geomInput.step = '0.1';
  geomInput.value = toleranceToAngleDeg(getBucketTolerance()).toFixed(1);
  geomInput.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  geomInput.title = 'Bend angle in degrees (0\u2013180)';

  const geomUnit = document.createElement('span');
  geomUnit.className = 'text-[10px] text-zinc-500';
  geomUnit.textContent = '\u00b0';

  geomSlider.addEventListener('input', () => {
    const tol = sliderPctToTolerance(parseInt(geomSlider.value, 10));
    setBucketTolerance(tol);
    geomInput.value = toleranceToAngleDeg(tol).toFixed(1);
    refreshBucketPreview();
  });
  const applyAngle = (): void => {
    const raw = parseFloat(geomInput.value);
    if (!Number.isFinite(raw)) { geomInput.value = toleranceToAngleDeg(getBucketTolerance()).toFixed(1); return; }
    const angle = Math.max(0, Math.min(180, raw));
    const tol = Math.cos(angle * Math.PI / 180);
    setBucketTolerance(tol);
    geomSlider.value = String(toleranceToSliderPct(tol));
    geomInput.value = angle.toFixed(1);
    refreshBucketPreview();
  };
  geomInput.addEventListener('change', applyAngle);
  geomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyAngle(); geomInput.blur(); } });

  geomRow.appendChild(geomSlider);
  geomRow.appendChild(geomInput);
  geomRow.appendChild(geomUnit);
  geomPanel.appendChild(geomRow);

  const geomHelp = document.createElement('div');
  geomHelp.className = 'text-[10px] text-zinc-500 mt-1';
  geomHelp.textContent = 'Coplanar only \u2190\u2014\u2014\u2192 Whole connected mesh';
  geomPanel.appendChild(geomHelp);
  wrap.appendChild(geomPanel);

  syncModeBtns();
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

function toleranceToAngleDeg(tol: number): number {
  return Math.acos(Math.max(-1, Math.min(1, tol))) * 180 / Math.PI;
}

function createReplaceControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700 hidden';

  const titleRow = document.createElement('div');
  titleRow.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  titleRow.textContent = 'Replace color';
  wrap.appendChild(titleRow);

  // Source color row: active swatch + hint
  const sourceLabel = document.createElement('div');
  sourceLabel.className = 'text-[10px] text-zinc-400 mb-1';
  sourceLabel.textContent = 'Source (click mesh to pick)';
  wrap.appendChild(sourceLabel);

  const sourceRow = document.createElement('div');
  sourceRow.className = 'flex items-center gap-2 mb-2';

  const sourceSwatch = document.createElement('div');
  sourceSwatch.className = 'w-6 h-6 rounded border-2 border-zinc-500 flex-shrink-0 bg-transparent';
  sourceSwatch.title = 'Current source color';
  sourceRow.appendChild(sourceSwatch);

  const sourceHint = document.createElement('span');
  sourceHint.className = 'text-[10px] text-zinc-500';
  sourceHint.textContent = '← click mesh';
  sourceRow.appendChild(sourceHint);

  wrap.appendChild(sourceRow);

  // Swatch grid: distinct colors from current regions
  const meshColorsLabel = document.createElement('div');
  meshColorsLabel.className = 'text-[10px] text-zinc-400 mb-1';
  meshColorsLabel.textContent = 'Mesh colors';
  wrap.appendChild(meshColorsLabel);

  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'flex flex-wrap gap-1 mb-2';
  wrap.appendChild(swatchGrid);

  const noColorsHint = document.createElement('div');
  noColorsHint.className = 'text-[10px] text-zinc-600 italic mb-2';
  noColorsHint.textContent = 'No painted regions yet';
  wrap.appendChild(noColorsHint);

  // Replace all button
  const actionRow = document.createElement('div');
  actionRow.className = 'flex items-center gap-2';

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'flex-1 px-2 py-1 rounded text-[11px] bg-blue-600/60 text-blue-100 hover:bg-blue-500/60 border border-blue-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  replaceBtn.textContent = 'Replace all';
  replaceBtn.title = 'Replace all regions of the source color with the active paint color';
  replaceBtn.disabled = true;
  actionRow.appendChild(replaceBtn);
  wrap.appendChild(actionRow);

  function syncSourceDisplay(): void {
    const src = getReplaceSourceColor();
    if (src) {
      sourceSwatch.style.backgroundColor = rgbToCSS(src);
      sourceSwatch.classList.remove('border-zinc-500');
      sourceSwatch.classList.add('border-white/60');
      sourceHint.textContent = rgbToHex(src);
      replaceBtn.disabled = false;
    } else {
      sourceSwatch.style.backgroundColor = 'transparent';
      sourceSwatch.classList.remove('border-white/60');
      sourceSwatch.classList.add('border-zinc-500');
      sourceHint.textContent = '← click mesh';
      replaceBtn.disabled = true;
    }
  }

  function syncSwatches(): void {
    swatchGrid.innerHTML = '';
    const colors = getDistinctRegionColors();
    noColorsHint.classList.toggle('hidden', colors.length > 0);
    for (const color of colors) {
      const sw = document.createElement('button');
      sw.className = 'w-6 h-6 rounded border-2 border-transparent hover:border-white/50 transition-colors';
      sw.style.backgroundColor = rgbToCSS(color);
      sw.title = `Set ${rgbToHex(color)} as source`;
      sw.addEventListener('click', () => {
        setReplaceSourceColor([...color] as [number, number, number]);
      });
      swatchGrid.appendChild(sw);
    }
  }

  replaceBtn.addEventListener('click', () => {
    const src = getReplaceSourceColor();
    if (!src) return;
    const count = replaceRegionColors(src, getColor());
    if (count > 0) setReplaceSourceColor(null);
  });

  onReplaceSourceColorChange(syncSourceDisplay);
  onRegionsChange(() => { syncSwatches(); syncSourceDisplay(); });

  syncSwatches();
  syncSourceDisplay();

  return wrap;
}

function createBrushControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700 hidden';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Brush size';
  wrap.appendChild(label);

  // Slider 0..200 = radius in tenths-of-a-unit (0..20 mesh units). Number input
  // accepts any non-negative value so users on larger meshes can type past the
  // slider cap.
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '200';
  slider.step = '1';
  slider.value = String(Math.round(Math.min(getBrushRadius(), 20) * 10));
  slider.className = 'flex-1 accent-blue-500 min-w-0';
  slider.title = 'Brush radius in mesh units (0 = single triangle)';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '0.1';
  input.value = getBrushRadius().toFixed(1);
  input.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  input.title = 'Brush radius in mesh units';

  const unit = document.createElement('span');
  unit.className = 'text-[10px] text-zinc-500';
  unit.textContent = 'u';

  slider.addEventListener('input', () => {
    const radius = parseInt(slider.value, 10) / 10;
    setBrushRadius(radius);
    input.value = radius.toFixed(1);
  });

  const applyRadius = (): void => {
    const raw = parseFloat(input.value);
    if (!Number.isFinite(raw) || raw < 0) {
      input.value = getBrushRadius().toFixed(1);
      return;
    }
    setBrushRadius(raw);
    slider.value = String(Math.round(Math.min(raw, 20) * 10));
    input.value = raw.toFixed(1);
  };
  input.addEventListener('change', applyRadius);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyRadius(); input.blur(); } });

  row.appendChild(slider);
  row.appendChild(input);
  row.appendChild(unit);
  wrap.appendChild(row);

  const help = document.createElement('div');
  help.className = 'text-[10px] text-zinc-500 mt-1';
  help.textContent = 'Single triangle \u2190\u2014\u2014\u2192 Wider brush';
  wrap.appendChild(help);

  // Surface mode \u2014 geodesic (default) flood-fills paint along the connected
  // surface so it never bleeds through a wall (no depth needed); slab keeps a
  // thin shell within Paint depth of the picked surface.
  const surfaceLabel = document.createElement('div');
  surfaceLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  surfaceLabel.textContent = 'Surface';
  wrap.appendChild(surfaceLabel);

  const surfaceRow = document.createElement('div');
  surfaceRow.className = 'grid grid-cols-2 gap-1';
  const surfaceButtons: Partial<Record<'geodesic' | 'slab', HTMLButtonElement>> = {};
  // Reassigned once their elements exist; called on every mode change.
  let syncDepthVisibility = (): void => {};
  // Reflect the active surface on the buttons. Both modes work for spray now
  // (a slab spray is gated by depth, a geodesic one by surface connectivity).
  const refreshSurfaceButtons = (): void => {
    for (const [k, b] of Object.entries(surfaceButtons)) {
      if (!b) continue;
      b.className = axisButtonClass(k === getBrushSurface());
    }
  };
  for (const [mode, labelText, tip] of [
    ['slab', 'Slab', 'Paint a thin shell within Paint depth of the surface. Use the depth knob to control how far through a wall paint reaches. Default.'],
    ['geodesic', 'Geodesic', 'Paint follows the connected surface and never bleeds through walls \u2014 no depth needed. Best for curved/organic shapes or geometry with nearby surfaces.'],
  ] as const) {
    const btn = document.createElement('button');
    btn.textContent = labelText;
    btn.title = tip;
    btn.className = axisButtonClass(mode === getBrushSurface());
    btn.addEventListener('click', () => {
      setBrushSurface(mode);
      refreshSurfaceButtons();
      syncDepthVisibility();
    });
    surfaceRow.appendChild(btn);
    surfaceButtons[mode] = btn;
  }
  wrap.appendChild(surfaceRow);

  // Paint depth (slab mode only) \u2014 how far through the surface a stroke reaches.
  const depthWrap = document.createElement('div');
  depthWrap.id = 'brush-depth-wrap';

  const depthLabel = document.createElement('div');
  depthLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  depthLabel.textContent = 'Paint depth';
  depthWrap.appendChild(depthLabel);

  const depthRow = document.createElement('div');
  depthRow.className = 'flex items-center gap-2';

  const depthSlider = document.createElement('input');
  depthSlider.id = 'brush-depth-slider';
  depthSlider.type = 'range';
  depthSlider.min = '0';
  depthSlider.max = '200';
  depthSlider.step = '1';
  depthSlider.value = String(Math.round(Math.min(getBrushPaintDepth(), 20) * 10));
  depthSlider.className = 'flex-1 accent-blue-500 min-w-0';
  depthSlider.title = 'How far through the surface paint reaches. 0 = auto (half the brush size). Lower values stop paint bleeding through thin/hollow walls.';

  const depthInput = document.createElement('input');
  depthInput.type = 'number';
  depthInput.min = '0';
  // No max: type past the slider for thicker walls.
  depthInput.step = '0.1';
  depthInput.value = getBrushPaintDepth().toFixed(1);
  depthInput.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  depthInput.title = 'Paint depth (0 = auto = half the brush size)';

  const depthUnit = document.createElement('span');
  depthUnit.className = 'text-[10px] text-zinc-500';
  depthUnit.textContent = 'u';

  depthSlider.addEventListener('input', () => {
    const d = parseInt(depthSlider.value, 10) / 10;
    setBrushPaintDepth(d);
    depthInput.value = d.toFixed(1);
  });
  const applyDepth = (): void => {
    const raw = parseFloat(depthInput.value);
    if (!Number.isFinite(raw) || raw < 0) { depthInput.value = getBrushPaintDepth().toFixed(1); return; }
    setBrushPaintDepth(raw);
    depthSlider.value = String(Math.round(Math.min(raw, 20) * 10));
    depthInput.value = raw.toFixed(1);
  };
  depthInput.addEventListener('change', applyDepth);
  depthInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyDepth(); depthInput.blur(); } });

  depthRow.appendChild(depthSlider);
  depthRow.appendChild(depthInput);
  depthRow.appendChild(depthUnit);
  depthWrap.appendChild(depthRow);

  const depthHelp = document.createElement('div');
  depthHelp.className = 'text-[10px] text-zinc-500 mt-1';
  depthHelp.textContent = 'Surface only \u2190\u2014\u2014\u2192 Through thicker walls \u00b7 0 = auto';
  depthWrap.appendChild(depthHelp);
  wrap.appendChild(depthWrap);

  syncDepthVisibility = (): void => {
    depthWrap.classList.toggle('hidden', getBrushSurface() !== 'slab');
  };
  syncDepthVisibility();

  // Wrap tolerance — how sharp an edge paint may flow across. Applies to both
  // surface modes: lower stops the stroke at corners (stays on one face), higher
  // lets it wrap around edges. 180° = wrap freely (the pre-slider behaviour).
  const wrapLabel = document.createElement('div');
  wrapLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  wrapLabel.textContent = 'Wrap tolerance';
  wrap.appendChild(wrapLabel);

  const wrapRow = document.createElement('div');
  wrapRow.className = 'flex items-center gap-2';

  const wrapSlider = document.createElement('input');
  wrapSlider.type = 'range';
  wrapSlider.min = String(WRAP_ANGLE_MIN);
  wrapSlider.max = String(WRAP_ANGLE_MAX);
  wrapSlider.step = '1';
  wrapSlider.value = String(getBrushWrapAngle());
  wrapSlider.className = 'flex-1 accent-blue-500 min-w-0';
  wrapSlider.title = 'How sharp an edge paint flows across. Lower keeps the stroke on one face (stops at corners); higher wraps around edges. 90° stops at right-angle folds; 180° wraps freely.';

  const wrapInput = document.createElement('input');
  wrapInput.type = 'number';
  wrapInput.min = String(WRAP_ANGLE_MIN);
  wrapInput.max = String(WRAP_ANGLE_MAX);
  wrapInput.step = '1';
  wrapInput.value = String(getBrushWrapAngle());
  wrapInput.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  wrapInput.title = 'Wrap tolerance in degrees (0–180). Edges that bend more than this block the stroke.';

  const wrapUnit = document.createElement('span');
  wrapUnit.className = 'text-[10px] text-zinc-500';
  wrapUnit.textContent = '°';

  wrapSlider.addEventListener('input', () => {
    setBrushWrapAngle(parseInt(wrapSlider.value, 10));
    wrapInput.value = String(getBrushWrapAngle());
  });
  const applyWrap = (): void => {
    const raw = parseInt(wrapInput.value, 10);
    if (!Number.isFinite(raw)) { wrapInput.value = String(getBrushWrapAngle()); return; }
    setBrushWrapAngle(raw);
    wrapSlider.value = String(getBrushWrapAngle());
    wrapInput.value = String(getBrushWrapAngle());
  };
  wrapInput.addEventListener('change', applyWrap);
  wrapInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyWrap(); wrapInput.blur(); } });

  wrapRow.appendChild(wrapSlider);
  wrapRow.appendChild(wrapInput);
  wrapRow.appendChild(wrapUnit);
  wrap.appendChild(wrapRow);

  const wrapHelp = document.createElement('div');
  wrapHelp.className = 'text-[10px] text-zinc-500 mt-1';
  wrapHelp.textContent = 'Stops at corners ←——→ Wraps around edges';
  wrap.appendChild(wrapHelp);

  // Spray (airbrush) — soft geodesic speckle instead of a solid fill. Forces
  // geodesic (a spray can't punch through a wall) and reveals strength/softness.
  const sprayLabel = document.createElement('div');
  sprayLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  sprayLabel.textContent = 'Spray (airbrush)';
  wrap.appendChild(sprayLabel);

  const sprayToggle = document.createElement('button');
  sprayToggle.id = 'brush-spray-toggle';
  sprayToggle.title = 'Airbrush: paint a soft speckle that fades out at the edges instead of a solid fill. Always follows the surface (geodesic).';
  wrap.appendChild(sprayToggle);

  // Strength + softness — shown only while spraying. 0..1 shown as a percent.
  const sprayWrap = document.createElement('div');
  sprayWrap.id = 'brush-spray-wrap';
  const pctControl = (labelText: string, id: string, get: () => number, set: (v: number) => void, tip: string): void => {
    const lab = document.createElement('div');
    lab.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
    lab.textContent = labelText;
    sprayWrap.appendChild(lab);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const slider = document.createElement('input');
    slider.id = id;
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(Math.round(get() * 100));
    slider.className = 'flex-1 accent-blue-500 min-w-0';
    slider.title = tip;
    const val = document.createElement('span');
    val.className = 'text-[10px] text-zinc-400 tabular-nums w-9 text-right';
    val.textContent = `${Math.round(get() * 100)}%`;
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10) / 100;
      set(v);
      val.textContent = `${Math.round(v * 100)}%`;
    });
    row.appendChild(slider);
    row.appendChild(val);
    sprayWrap.appendChild(row);
  };
  pctControl('Strength', 'brush-spray-strength', getBrushSprayStrength, setBrushSprayStrength, 'How dense the speckle is (core coverage). Lower = lighter spackle.');
  pctControl('Softness', 'brush-spray-softness', getBrushSpraySoftness, setBrushSpraySoftness, 'How wide the feathered, fading edge is.');
  wrap.appendChild(sprayWrap);

  const syncSpray = (): void => {
    const on = isBrushSpray();
    sprayToggle.textContent = on ? '◉ Spray: On' : '○ Spray: Off';
    sprayToggle.className = on
      ? 'w-full px-2 py-1 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors'
      : 'w-full px-2 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-300 border border-zinc-600/50 hover:bg-zinc-700 transition-colors';
    sprayWrap.classList.toggle('hidden', !on);
    // Spray keeps the active surface mode (slab or geodesic) — the depth slider
    // stays visible whenever slab is selected, spraying or not.
    refreshSurfaceButtons();
    syncDepthVisibility();
  };
  sprayToggle.addEventListener('click', () => { setBrushSpray(!isBrushSpray()); syncSpray(); });
  syncSpray();

  // Brush shape selector
  const shapeLabel = document.createElement('div');
  shapeLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  shapeLabel.textContent = 'Brush shape';
  wrap.appendChild(shapeLabel);

  const shapeRow = document.createElement('div');
  shapeRow.className = 'grid grid-cols-3 gap-1';
  const brushShapeButtons: Partial<Record<BrushShape, HTMLButtonElement>> = {};
  for (const [s, icon, tip] of [
    ['circle',  '\u25cf Circle',  'Circular brush (sphere test in 3D)'],
    ['square',  '\u25a0 Square',  'Cubic brush (axis-aligned box test in 3D)'],
    ['diamond', '\u25c6 Diamond', 'Diamond brush (L1 distance test in 3D)'],
  ] as const) {
    const btn = document.createElement('button');
    btn.textContent = icon;
    btn.title = tip;
    btn.className = axisButtonClass(s === getBrushShape());
    btn.addEventListener('click', () => {
      setBrushShape(s);
      for (const [k, b] of Object.entries(brushShapeButtons)) {
        if (b) b.className = axisButtonClass(k === getBrushShape());
      }
    });
    shapeRow.appendChild(btn);
    brushShapeButtons[s] = btn;
  }
  wrap.appendChild(shapeRow);

  // Smooth edges — subdivide the mesh under the brush so the painted region's
  // outline is rounded instead of following the existing tessellation.
  const smoothLabel = document.createElement('div');
  smoothLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-2 font-medium';
  smoothLabel.textContent = 'Edge smoothing';

  const smoothToggle = document.createElement('button');
  smoothToggle.title = 'Subdivide the mesh under the brush so the painted edge is smooth/rounded instead of following triangle boundaries. Adds triangles near the stroke and requires a brush size above 0.';

  // Detail slider: brush radius ÷ value = target triangle edge near the stroke.
  // Higher = smoother edge + more triangles. Typeable for precision.
  const fineRow = document.createElement('div');
  fineRow.className = 'flex items-center gap-2 mt-1';

  const detailSlider = document.createElement('input');
  detailSlider.type = 'range';
  detailSlider.min = String(SMOOTH_DIVISOR_MIN);
  detailSlider.max = String(SMOOTH_DIVISOR_MAX);
  detailSlider.step = '1';
  detailSlider.value = String(getBrushSmoothDivisor());
  detailSlider.className = 'flex-1 accent-blue-500 min-w-0';
  detailSlider.title = 'Smooth-edge detail: brush radius ÷ this = target triangle edge. Higher = smoother edge, more triangles.';

  const detailInput = document.createElement('input');
  detailInput.type = 'number';
  detailInput.min = String(SMOOTH_DIVISOR_MIN);
  detailInput.max = String(SMOOTH_DIVISOR_MAX);
  detailInput.step = '1';
  detailInput.value = String(getBrushSmoothDivisor());
  detailInput.className = 'w-16 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  detailInput.title = `Detail (brush radius ÷ this = target edge). ${SMOOTH_DIVISOR_MIN}–${SMOOTH_DIVISOR_MAX}.`;

  detailSlider.addEventListener('input', () => {
    setBrushSmoothDivisor(parseInt(detailSlider.value, 10));
    detailInput.value = String(getBrushSmoothDivisor());
  });
  const applyDetail = (): void => {
    const raw = parseInt(detailInput.value, 10);
    if (!Number.isFinite(raw)) { detailInput.value = String(getBrushSmoothDivisor()); return; }
    setBrushSmoothDivisor(raw);
    detailSlider.value = String(getBrushSmoothDivisor());
    detailInput.value = String(getBrushSmoothDivisor());
  };
  detailInput.addEventListener('change', applyDetail);
  detailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyDetail(); detailInput.blur(); } });

  fineRow.appendChild(detailSlider);
  fineRow.appendChild(detailInput);

  const smoothHelp = document.createElement('div');
  smoothHelp.className = 'text-[10px] text-zinc-500 mt-1';
  smoothHelp.textContent = 'Smooth-edge detail · higher → smoother, more triangles';

  const syncSmoothToggle = (): void => {
    const on = isBrushSmooth();
    smoothToggle.className = on
      ? 'w-full px-2 py-1 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center'
      : 'w-full px-2 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
    smoothToggle.textContent = on ? '◉ Smooth edges: On' : '○ Smooth edges: Off';
    fineRow.classList.toggle('hidden', !on);
    smoothHelp.classList.toggle('hidden', !on);
  };
  smoothToggle.addEventListener('click', () => { setBrushSmooth(!isBrushSmooth()); syncSmoothToggle(); });

  wrap.appendChild(smoothLabel);
  wrap.appendChild(smoothToggle);
  wrap.appendChild(fineRow);
  wrap.appendChild(smoothHelp);
  syncSmoothToggle();

  return wrap;
}


function createSlabControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700 hidden';

  // Axis selector
  const axisRow = document.createElement('div');
  axisRow.className = 'mb-2';
  const axisLabel = document.createElement('div');
  axisLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  axisLabel.textContent = 'Slab axis';
  axisRow.appendChild(axisLabel);

  const axisBtns = document.createElement('div');
  axisBtns.className = 'grid grid-cols-3 gap-1';
  for (const a of ['x', 'y', 'z'] as const) {
    const btn = document.createElement('button');
    btn.dataset.axis = a;
    btn.textContent = a.toUpperCase();
    btn.className = axisButtonClass(a === getSlabAxis());
    btn.addEventListener('click', () => {
      setSlabAxis(a);
      for (const child of Array.from(axisBtns.children)) {
        const el = child as HTMLButtonElement;
        el.className = axisButtonClass(el.dataset.axis === getSlabAxis());
      }
    });
    axisBtns.appendChild(btn);
  }
  axisRow.appendChild(axisBtns);
  wrap.appendChild(axisRow);

  // Hint text
  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-400 leading-relaxed';
  hint.innerHTML = 'Hover the model to preview the slab plane.<br>Click and drag to extend the slab along the chosen axis. Release to paint.';
  wrap.appendChild(hint);

  wrap.appendChild(createShapeSmoothControls());

  return wrap;
}

function axisButtonClass(active: boolean): string {
  if (active) {
    return 'px-2 py-1 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors';
  }
  return 'px-2 py-1 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors';
}

/** Edge-smoothing toggle + detail slider shared by the slab and shape tools.
 *  Mirrors the brush's smoothing controls, but the detail is a resolution: the
 *  target boundary edge length is the model's bbox diagonal ÷ this value. The
 *  state is shared across both tools (see `setShapeSmooth` in paintMode). */
function createShapeSmoothControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Edge smoothing';

  const toggle = document.createElement('button');
  toggle.title = 'Subdivide the mesh near the painted region boundary so its edge is smooth instead of following triangle boundaries. Adds triangles near the edge.';

  const fineRow = document.createElement('div');
  fineRow.className = 'flex items-center gap-2 mt-1';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(SMOOTH_DIVISOR_MIN);
  slider.max = String(SMOOTH_DIVISOR_MAX);
  slider.step = '1';
  slider.value = String(getShapeSmoothResolution());
  slider.className = 'flex-1 accent-blue-500 min-w-0';
  slider.title = 'Smooth-edge detail: model bbox diagonal ÷ this = target triangle edge. Higher = smoother edge, more triangles.';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(SMOOTH_DIVISOR_MIN);
  input.max = String(SMOOTH_DIVISOR_MAX);
  input.step = '1';
  input.value = String(getShapeSmoothResolution());
  input.className = 'w-16 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  input.title = `Detail (model size ÷ this = target edge). ${SMOOTH_DIVISOR_MIN}–${SMOOTH_DIVISOR_MAX}.`;

  slider.addEventListener('input', () => {
    setShapeSmoothResolution(parseInt(slider.value, 10));
    input.value = String(getShapeSmoothResolution());
    for (const sync of shapeSmoothSyncs) sync();
  });
  const apply = (): void => {
    const raw = parseInt(input.value, 10);
    if (!Number.isFinite(raw)) { input.value = String(getShapeSmoothResolution()); return; }
    setShapeSmoothResolution(raw);
    slider.value = String(getShapeSmoothResolution());
    input.value = String(getShapeSmoothResolution());
    for (const sync of shapeSmoothSyncs) sync();
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); input.blur(); } });

  fineRow.appendChild(slider);
  fineRow.appendChild(input);

  const help = document.createElement('div');
  help.className = 'text-[10px] text-zinc-500 mt-1';
  help.textContent = 'Smooth-edge detail · higher → smoother, more triangles';

  const sync = (): void => {
    const on = isShapeSmooth();
    toggle.className = on
      ? 'w-full px-2 py-1 rounded text-[10px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center'
      : 'w-full px-2 py-1 rounded text-[10px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
    toggle.textContent = on ? '◉ Smooth edges: On' : '○ Smooth edges: Off';
    fineRow.classList.toggle('hidden', !on);
    help.classList.toggle('hidden', !on);
    slider.value = String(getShapeSmoothResolution());
    input.value = String(getShapeSmoothResolution());
  };
  toggle.addEventListener('click', () => { setShapeSmooth(!isShapeSmooth()); for (const s of shapeSmoothSyncs) s(); });

  wrap.appendChild(label);
  wrap.appendChild(toggle);
  wrap.appendChild(fineRow);
  wrap.appendChild(help);
  shapeSmoothSyncs.push(sync);
  sync();

  return wrap;
}

function createBoxControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700 hidden';

  // Shape type selector
  const shapeTypeLabel = document.createElement('div');
  shapeTypeLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  shapeTypeLabel.textContent = 'Shape';
  wrap.appendChild(shapeTypeLabel);

  const shapeRow = document.createElement('div');
  shapeRow.className = 'grid grid-cols-4 gap-1 mb-2';
  const shapeBtns: Partial<Record<ShapeType, HTMLButtonElement>> = {};
  for (const [s, label, tip] of [
    ['box',      '□ Box',    'Oriented bounding box'],
    ['sphere',   '○ Sphere', 'Sphere centered on the gizmo origin; size X = diameter'],
    ['cylinder', '⊖ Cyl',   'Cylinder aligned to local Y; size X = diameter, Y = height'],
    ['cone',     '△ Cone',  'Cone: apex at top, base at bottom; size X = base diameter, Y = height'],
  ] as const) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = tip;
    btn.className = axisButtonClass(s === getShapeType());
    btn.addEventListener('click', () => {
      setShapeType(s);
      for (const [k, b] of Object.entries(shapeBtns)) {
        if (b) b.className = axisButtonClass(k === getShapeType());
      }
      updatePaintShapeButton();
    });
    shapeRow.appendChild(btn);
    shapeBtns[s] = btn;
  }
  wrap.appendChild(shapeRow);

  // Transform mode buttons — translate / rotate / scale, drives the gizmo.
  const modeLabel = document.createElement('div');
  modeLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  modeLabel.textContent = 'Transform';
  wrap.appendChild(modeLabel);

  const modeRow = document.createElement('div');
  modeRow.className = 'grid grid-cols-3 gap-1 mb-2';
  const modeBtns: Partial<Record<BoxMode, HTMLButtonElement>> = {};
  for (const m of ['translate', 'rotate', 'scale'] as const) {
    const btn = document.createElement('button');
    btn.textContent = m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Resize';
    btn.className = axisButtonClass(m === getBoxMode());
    btn.title = `Switch the gizmo to ${m} mode`;
    btn.addEventListener('click', () => {
      setBoxMode(m);
      for (const [k, b] of Object.entries(modeBtns)) {
        if (b) b.className = axisButtonClass(k === getBoxMode());
      }
    });
    modeRow.appendChild(btn);
    modeBtns[m] = btn;
  }
  wrap.appendChild(modeRow);

  // Numeric readout — center / size / rotation. Two-way synced with the gizmo.
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-[auto_repeat(3,_minmax(0,_1fr))] gap-1 text-[10px] text-zinc-400 items-center';

  const centerInputs = makeVectorRow(grid, 'Pos',  -1e6, 1e6, 0.1, (v) => setBox({ center: v }));
  const sizeInputs   = makeVectorRow(grid, 'Size',  0.001, 1e6, 0.1, (v) => setBox({ size: v }));
  const rotInputs    = makeVectorRow(grid, 'Rot°', -360, 360, 1, (v) => {
    const ex = v[0] * Math.PI / 180;
    const ey = v[1] * Math.PI / 180;
    const ez = v[2] * Math.PI / 180;
    const q = eulerXYZToQuat(ex, ey, ez);
    setBox({ quaternion: q });
  });
  wrap.appendChild(grid);

  // Action: paint inside the current shape + eye toggle.
  const actionRow = document.createElement('div');
  actionRow.className = 'mt-2 flex flex-col gap-1';

  const paintAndEyeRow = document.createElement('div');
  paintAndEyeRow.className = 'flex items-center gap-1';

  paintShapeBtn = document.createElement('button');
  paintShapeBtn.className = 'flex-1 px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 hover:bg-blue-500/50 border border-blue-500/50 transition-colors font-medium';
  updatePaintShapeButton();
  paintShapeBtn.addEventListener('click', () => {
    const painted = commitBox();
    if (painted === 0) {
      paintShapeBtn!.textContent = 'No triangles in shape';
      window.setTimeout(() => { if (paintShapeBtn) updatePaintShapeButton(); }, 1200);
    }
  });
  paintAndEyeRow.appendChild(paintShapeBtn);

  const eyeToggleBtn = document.createElement('button');
  eyeToggleBtn.className = 'shrink-0 w-7 h-7 flex items-center justify-center rounded bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 border border-zinc-600/40 transition-colors';
  eyeToggleBtn.title = 'Hide/show the shape in the viewport';
  eyeToggleBtn.innerHTML = eyeIconSVG();
  eyeToggleBtn.addEventListener('click', () => {
    setShapeVisible(!getShapeVisible());
  });
  paintAndEyeRow.appendChild(eyeToggleBtn);

  actionRow.appendChild(paintAndEyeRow);

  // Keep the eye button in sync with visibility state.
  onShapeVisibilityChange(() => {
    const vis = getShapeVisible();
    eyeToggleBtn.innerHTML = vis ? eyeIconSVG() : eyeOffIconSVG();
    eyeToggleBtn.title = vis ? 'Hide shape' : 'Show shape';
    eyeToggleBtn.classList.toggle('opacity-50', !vis);
  });

  const help = document.createElement('div');
  help.className = 'text-[10px] text-zinc-500 leading-relaxed';
  help.textContent = 'Drag the gizmo handles in the viewport, or edit values above. The shape fades after painting and brightens when you interact with it again.';
  actionRow.appendChild(help);

  wrap.appendChild(createShapeSmoothControls());
  wrap.appendChild(actionRow);

  // Keep the numeric inputs in sync when the gizmo moves.
  onBoxChange((box) => {
    if (!isInputFocused(centerInputs)) setVector(centerInputs, box.center, 2);
    if (!isInputFocused(sizeInputs))   setVector(sizeInputs,   box.size,   2);
    if (!isInputFocused(rotInputs)) {
      const e = quatToEulerXYZ(box.quaternion);
      setVector(rotInputs, [e[0] * 180 / Math.PI, e[1] * 180 / Math.PI, e[2] * 180 / Math.PI], 1);
    }
  });

  return wrap;
}

function updatePaintShapeButton(): void {
  if (!paintShapeBtn) return;
  const labels: Record<ShapeType, string> = {
    box: 'Paint inside box',
    sphere: 'Paint inside sphere',
    cylinder: 'Paint inside cylinder',
    cone: 'Paint inside cone',
  };
  paintShapeBtn.textContent = labels[getShapeType()];
  paintShapeBtn.title = `Commit every triangle inside the ${getShapeType()} as a new color region`;
}

/** Build a label + 3 number inputs (X/Y/Z) for a vector property. */
function makeVectorRow(parent: HTMLElement, label: string, min: number, max: number, step: number, onChange: (v: [number, number, number]) => void): HTMLInputElement[] {
  const labelEl = document.createElement('span');
  labelEl.className = 'text-zinc-500 text-right pr-1 tabular-nums';
  labelEl.textContent = label;
  parent.appendChild(labelEl);

  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < 3; i++) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = '0';
    input.className = 'min-w-0 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
    const apply = (): void => {
      const v = inputs.map(x => parseFloat(x.value));
      if (v.every(Number.isFinite)) onChange([v[0], v[1], v[2]]);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); input.blur(); } });
    parent.appendChild(input);
    inputs.push(input);
  }
  return inputs;
}

function setVector(inputs: HTMLInputElement[], vec: [number, number, number], decimals: number): void {
  for (let i = 0; i < 3; i++) inputs[i].value = vec[i].toFixed(decimals);
}

function isInputFocused(inputs: HTMLInputElement[]): boolean {
  return inputs.some(i => document.activeElement === i);
}

/** Convert XYZ Euler angles (radians) to a quaternion [x, y, z, w]. */
function eulerXYZToQuat(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Convert a quaternion to XYZ Euler angles (radians). Matches THREE's
 *  Euler.setFromQuaternion with order 'XYZ' so the gizmo readout stays
 *  consistent with the gizmo input. */
function quatToEulerXYZ(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.99999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex, ey, ez];
}

function updateVisibilityButton(): void {
  if (!visibilityBtn) return;
  visibilityBtn.textContent = isPaintVisible() ? 'Hide all' : 'Show all';
}

function updateUndoClearButton(): void {
  if (!undoClearBtn) return;
  const can = canUndoClear();
  undoClearBtn.disabled = !can;
  undoClearBtn.classList.toggle('opacity-40', !can);
  undoClearBtn.classList.toggle('cursor-not-allowed', !can);
}

function updateUndoButton(): void {
  if (!undoBtn) return;
  const can = getRegions().length > 0;
  undoBtn.disabled = !can;
  undoBtn.classList.toggle('opacity-40', !can);
  undoBtn.classList.toggle('cursor-not-allowed', !can);
}

function updateRedoButton(): void {
  if (!redoBtn) return;
  const can = canRedoRegion();
  redoBtn.disabled = !can;
  redoBtn.classList.toggle('opacity-40', !can);
  redoBtn.classList.toggle('cursor-not-allowed', !can);
}

// Active hover-release closure for the labels list. Releasing it inside
// `updateLabelList` before `innerHTML = ''` matters: if a fresh run fires
// `setPaintLabels` while the user's pointer is over a row, the row DOM is
// destroyed before its `mouseleave` handler can run, and the THREE highlight
// mesh would otherwise stay parented to the viewport until the next preview.
let activeLabelHoverRelease: (() => void) | null = null;

function releaseLabelHover(): void {
  if (activeLabelHoverRelease) {
    activeLabelHoverRelease();
    activeLabelHoverRelease = null;
  }
}

function updateLabelList(container: HTMLElement): void {
  const labels = getPaintLabels();
  releaseLabelHover();
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-1';
  const headerLabel = document.createElement('div');
  headerLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  headerLabel.textContent = 'Labels';
  header.appendChild(headerLabel);
  if (labels.length > 0) {
    const count = document.createElement('span');
    count.className = 'text-[10px] text-zinc-600 tabular-nums';
    count.textContent = String(labels.length);
    header.appendChild(count);
  }
  container.appendChild(header);

  if (labels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-[10px] text-zinc-500 leading-snug';
    empty.innerHTML = 'No labels in this run. Wrap features with <code class="px-1 py-0.5 rounded bg-zinc-900/60 text-zinc-300 text-[10px]">api.label(shape, "name")</code> in your code to get clickable labelled regions here.';
    container.appendChild(empty);
    return;
  }

  // Which labels are already painted, so the row can show a "painted" hint
  // instead of pretending nothing's there. A label may be painted multiple
  // times (e.g. a different color over the same area); we only need to know
  // that *something* paints it.
  const paintedLabels = new Set<string>();
  for (const r of getRegions()) {
    if (r.descriptor.kind === 'byLabel') paintedLabels.add(r.descriptor.label);
  }

  for (const label of labels) {
    container.appendChild(createLabelRow(label, paintedLabels.has(label.name)));
  }
}

// Triangle count of the *base* mesh the current label snapshot was built
// against. The label rows are (re)built only when the labels snapshot changes
// (a fresh run), at which point `getPaintMesh()` is that base mesh. Captured
// here so the hover preview can detect later topology changes (subdivision)
// that would make the snapshot's raw triangle ids stale. -1 = unknown.
let labelBaseNumTri = -1;

function createLabelRow(label: LabelInfo, alreadyPainted: boolean): HTMLElement {
  // Rows are rebuilt on every labels-snapshot change, which coincides with the
  // base mesh being the current paint mesh — record its triangle count so the
  // hover handler can later tell whether the working mesh has been refined.
  labelBaseNumTri = getPaintMesh()?.numTri ?? -1;

  const row = document.createElement('div');
  row.className = 'flex items-center gap-1.5 py-0.5 group rounded px-1 -mx-1 hover:bg-zinc-700/40 transition-colors cursor-pointer';
  row.dataset.labelName = label.name;
  row.title = alreadyPainted
    ? `Paint label "${label.name}" again with the current color`
    : `Paint label "${label.name}" with the current color`;

  // Hover-to-highlight: render a 40%-opacity overlay over the label's
  // triangles in the current paint color so the user can preview which
  // region a click will paint. Skip the preview entirely when the active
  // paint mesh is no longer the run's *base* mesh the label was built
  // against — `paintByLabel`'s commit path remaps base ids to refined ids
  // via `parentToChildren`, but `previewTriangles` doesn't, so indexing raw
  // base ids into a refined mesh highlights the wrong triangles. A simple
  // `maxTriId >= numTri` bound is NOT enough: smooth/slab/cylinder
  // subdivision REBUILDS and RENUMBERS every triangle, usually producing
  // *more* triangles, so the stale ids still fall inside the new range and
  // pass that bound while pointing at unrelated triangles. Instead gate on
  // the base-mesh triangle count captured when the labels were last built
  // (see `labelBaseNumTri`): any change to the working mesh's topology means
  // the label ids no longer line up, so the preview is suppressed.
  row.addEventListener('mouseenter', () => {
    if (label.triangles.size === 0) return;
    const mesh = getPaintMesh();
    if (!mesh) return;
    // Topology changed since the labels were built (e.g. subdivision) — the
    // label's triangle ids are stale, so don't preview against this mesh.
    if (labelBaseNumTri < 0 || mesh.numTri !== labelBaseNumTri) return;
    if (label.maxTriId >= mesh.numTri) return;
    releaseLabelHover();
    activeLabelHoverRelease = previewTriangles(label.triangles, getColor());
  });
  row.addEventListener('mouseleave', releaseLabelHover);

  row.addEventListener('click', () => {
    if (label.triangles.size === 0) return;
    releaseLabelHover();
    // Clone the triangle set so later region edits don't mutate the label
    // snapshot. byLabel descriptor matches what partwright.paintByLabel emits,
    // so re-hydration on session reload goes through the same resolve path
    // — including refined-mesh remapping via `parentToChildren`.
    addRegion(
      label.name,
      [...getColor()] as [number, number, number],
      'paintbrush',
      { kind: 'byLabel', label: label.name },
      new Set(label.triangles),
      true,
      getSlotId() ?? undefined,
    );
  });

  const dot = document.createElement('span');
  dot.className = 'w-3 h-3 rounded-sm shrink-0 border border-zinc-600/60';
  if (alreadyPainted) {
    // Show the most recently-applied color for this label so the user can
    // distinguish "blue eye" from "red eye" at a glance.
    const last = [...getRegions()].reverse().find(r => r.descriptor.kind === 'byLabel' && r.descriptor.label === label.name);
    if (last) dot.style.backgroundColor = rgbToCSS(last.color);
  }

  const nameEl = document.createElement('span');
  nameEl.className = 'text-[11px] truncate flex-1 text-zinc-300';
  nameEl.textContent = label.name;

  const count = document.createElement('span');
  count.className = 'text-[10px] text-zinc-600 tabular-nums';
  count.textContent = `${label.triangleCount}△`;

  row.appendChild(dot);
  row.appendChild(nameEl);
  row.appendChild(count);

  if (alreadyPainted) {
    const badge = document.createElement('span');
    badge.className = 'shrink-0 text-[10px] text-emerald-400 leading-none';
    badge.textContent = '✓';
    badge.title = 'Already painted (click to paint again with the current color)';
    row.appendChild(badge);
  }

  return row;
}

function updateRegionList(container: HTMLElement): void {
  const regions = getRegions();
  container.innerHTML = '';

  if (regions.length === 0) return;

  for (const region of regions) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5 py-0.5 group rounded px-1 -mx-1 hover:bg-zinc-700/40 transition-colors cursor-default';
    row.dataset.regionId = String(region.id);

    // Hover-to-locate: tint the painted triangles with the region's own color
    // so the user can see at a glance where in the viewport this row lives.
    // Uses the same translucent overlay the brush/bucket tools draw under the
    // cursor — mirrored on the panel side. Teardown fires on mouseleave so a
    // stale highlight never sticks.
    let releaseHover: (() => void) | null = null;
    row.addEventListener('mouseenter', () => {
      if (region.triangles.size === 0) return;
      releaseHover = previewTriangles(region.triangles, region.color);
    });
    row.addEventListener('mouseleave', () => {
      if (releaseHover) { releaseHover(); releaseHover = null; }
    });

    // Color swatch doubles as an edit affordance: the dot IS the native
    // <input type="color">, styled to read as a swatch. The OS picker pops up
    // anchored to the swatch (no hidden offscreen input → no "picker closes
    // when I move the mouse" surprise). `change` commits a single
    // updateRegionColor on release, so the mesh reconciler only fires once
    // per pick instead of on every channel drag.
    const dot = document.createElement('input');
    dot.type = 'color';
    dot.value = rgbToHex(region.color);
    dot.className = 'w-3.5 h-3.5 shrink-0 rounded-sm border border-zinc-500 hover:border-white/60 cursor-pointer bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0';
    dot.title = `Click to change colour (${rgbToHex(region.color)})`;
    if (!region.visible) dot.classList.add('opacity-30');
    dot.addEventListener('change', () => {
      const hex = dot.value;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      updateRegionColor(region.id, [r, g, b]);
    });
    dot.addEventListener('click', (e) => e.stopPropagation());

    const label = document.createElement('span');
    label.className = `text-[11px] truncate flex-1 ${region.visible ? 'text-zinc-400' : 'text-zinc-600 line-through'}`;
    label.textContent = region.name;

    const count = document.createElement('span');
    count.className = 'text-[10px] text-zinc-600 tabular-nums';
    count.textContent = `${region.triangles.size}\u25B3`;

    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'shrink-0 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition-colors';
    eyeBtn.title = region.visible ? 'Hide this region' : 'Show this region';
    eyeBtn.dataset.action = 'toggle-region-visibility';
    eyeBtn.innerHTML = region.visible ? eyeIconSVG() : eyeOffIconSVG();
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setRegionVisibility(region.id, !region.visible);
    });

    const trashBtn = document.createElement('button');
    trashBtn.className = 'shrink-0 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors';
    trashBtn.title = 'Delete this region';
    trashBtn.dataset.action = 'delete-region';
    trashBtn.innerHTML = trashIconSVG();
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRegion(region.id);
    });

    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(count);
    row.appendChild(eyeBtn);
    row.appendChild(trashBtn);
    container.appendChild(row);
  }
}

function eyeIconSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function eyeOffIconSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><line x1="2" y1="2" x2="14" y2="14"/></svg>';
}

function trashIconSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M3 4h10M5 4V2.5a1 1 0 011-1h4a1 1 0 011 1V4m-6 0v9.5a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>';
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

/** Deactivate paint mode externally (e.g. when switching tabs). */
export function forceDeactivate(): void {
  if (isActive()) {
    deactivate();
    updateButtonState(false);
    closeViewportPanel(paintRegistryEntry);
    document.removeEventListener('keydown', onPaintEscape);
    pickerPanel?.classList.add('hidden');
  }
}

// Let the annotate sub-modes deactivate paint without importing this module.
registerExclusiveMode('paint', forceDeactivate);

/** True if the paint menu is open (paint mode is active). */
export function isPaintOpen(): boolean {
  return isActive();
}
