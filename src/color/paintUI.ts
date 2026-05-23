// Paint mode UI — button toggle, color picker, region count badge, tool
// selection (bucket / brush / slab), and undo/redo/hide/clear actions.

import {
  activate,
  deactivate,
  isActive,
  setColor,
  setTool,
  getTool,
  setBucketTolerance,
  getBucketTolerance,
  setBrushRadius,
  getBrushRadius,
  setBrushShape,
  getBrushShape,
  setBrushSmooth,
  isBrushSmooth,
  setBrushSmoothDivisor,
  getBrushSmoothDivisor,
  SMOOTH_DIVISOR_MIN,
  SMOOTH_DIVISOR_MAX,
  setShapeSmooth,
  isShapeSmooth,
  setShapeSmoothResolution,
  getShapeSmoothResolution,
  setSlabAxis,
  getSlabAxis,
  previewTriangles,
  type PaintTool,
  type BrushShape,
} from './paintMode';
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
} from './regions';
import { forceDeactivate as forceDeactivateAnnotate } from '../annotations/annotateUI';
import { forceDeactivate as forceDeactivateAnnotateText } from '../annotations/textMode';
import { forceDeactivate as forceDeactivateAnnotateSelect } from '../annotations/selectMode';
import { setBoxMode, getBoxMode, setBox, commitBox, onBoxChange, setShapeType, getShapeType, getShapeVisible, setShapeVisible, onShapeVisibilityChange, type BoxMode, type ShapeType } from './boxDrag';
import { forceDeactivate as closeSimplifyMenu } from '../ui/simplifyUI';

const PRESET_COLORS: [number, number, number][] = [
  // Warm
  [0.92, 0.26, 0.21], // red
  [1.00, 0.60, 0.00], // orange
  [1.00, 0.76, 0.03], // yellow
  [0.55, 0.36, 0.22], // brown
  // Cool
  [0.55, 0.85, 0.20], // lime
  [0.30, 0.69, 0.31], // green
  [0.00, 0.74, 0.83], // teal
  [0.13, 0.59, 0.95], // blue
  // Purples / pinks
  [0.10, 0.20, 0.55], // navy
  [0.61, 0.15, 0.69], // purple
  [0.93, 0.05, 0.65], // magenta
  [0.91, 0.12, 0.39], // pink
  // Neutrals
  [1.00, 1.00, 1.00], // white
  [0.75, 0.75, 0.75], // light gray
  [0.35, 0.35, 0.35], // dark gray
  [0.00, 0.00, 0.00], // black
];

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
// Shape-smoothing controls appear in both the slab and box panels but share one
// state; re-sync each instance's display on tool switch so neither goes stale.
const shapeSmoothSyncs: (() => void)[] = [];

/** Initialize the paint UI inside the clip-controls overlay area. */
export function initPaintUI(controlsContainer: HTMLElement): void {
  paintBtn = document.createElement('button');
  paintBtn.id = 'paint-toggle';
  paintBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  paintBtn.textContent = '\uD83C\uDFA8 Paint';
  paintBtn.title = 'Paint color regions on model faces';

  regionCountBadge = document.createElement('span');
  regionCountBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white leading-none';
  paintBtn.appendChild(regionCountBadge);

  paintBtn.addEventListener('click', togglePaintMode);

  const measureBtn = controlsContainer.querySelector('#measure-toggle');
  if (measureBtn) {
    controlsContainer.insertBefore(paintBtn, measureBtn);
  } else {
    controlsContainer.appendChild(paintBtn);
  }

  pickerPanel = createPickerPanel();
  controlsContainer.appendChild(pickerPanel);

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

function togglePaintMode(): void {
  if (isActive()) {
    deactivate();
    updateButtonState(false);
    pickerPanel?.classList.add('hidden');
  } else {
    forceDeactivateAnnotate();
    forceDeactivateAnnotateText();
    forceDeactivateAnnotateSelect();
    closeSimplifyMenu();
    activate();
    updateButtonState(true);
    pickerPanel?.classList.remove('hidden');
    syncToolPanels();
  }
}

function updateButtonState(active: boolean): void {
  if (!paintBtn) return;
  if (active) {
    paintBtn.className = 'px-2 py-1 rounded text-xs bg-blue-500/30 backdrop-blur text-blue-300 border border-blue-500/50 transition-colors';
  } else {
    paintBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  }
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
  panel.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  panel.style.minWidth = '200px';
  panel.style.maxWidth = '240px';

  // === Tool selector ===
  const toolTitle = document.createElement('div');
  toolTitle.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  toolTitle.textContent = 'Tool';
  panel.appendChild(toolTitle);

  const toolRow = document.createElement('div');
  toolRow.className = 'grid grid-cols-2 gap-1 mb-2.5';
  toolRow.appendChild(createToolButton('bucket', '\u{1FAA3} Bucket', 'Flood-fill across coplanar faces'));
  toolRow.appendChild(createToolButton('brush', '\u{1F58C}\uFE0F Brush', 'Paint individual triangles (drag to paint)'));
  toolRow.appendChild(createToolButton('slab', '\u{1F9F1} Slab', 'Paint all faces inside an axis-aligned range'));
  toolRow.appendChild(createToolButton('box', '\u25C6 Shape', 'Paint everything inside a positionable, rotatable, scalable 3D shape (box, sphere, cylinder, or cone)'));
  panel.appendChild(toolRow);

  // === Color picker ===
  const title = document.createElement('div');
  title.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  title.textContent = 'Color';
  panel.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-4 gap-1.5 mb-2';

  for (const color of PRESET_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'w-6 h-6 rounded border-2 border-transparent hover:border-white/50 transition-colors';
    swatch.style.backgroundColor = rgbToCSS(color);
    swatch.title = rgbToHex(color);
    swatch.addEventListener('click', () => {
      setColor(color);
      updateActiveSwatch(grid, swatch);
    });
    grid.appendChild(swatch);
  }
  const first = grid.children[0] as HTMLElement;
  if (first) first.classList.add('border-white/80', 'ring-1', 'ring-white/30');
  panel.appendChild(grid);

  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-1.5';

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
    setColor([r, g, b]);
    for (const child of Array.from(grid.children)) {
      (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
    }
  });

  const customLabel = document.createElement('span');
  customLabel.className = 'text-[10px] text-zinc-500';
  customLabel.textContent = 'Custom';

  customRow.appendChild(colorInput);
  customRow.appendChild(customLabel);
  panel.appendChild(customRow);

  // === Bucket tool controls (tolerance slider + number input) ===
  bucketControls = createBucketControls();
  panel.appendChild(bucketControls);

  // === Brush tool controls (radius slider + number input) ===
  brushControls = createBrushControls();
  panel.appendChild(brushControls);

  // === Slab tool controls ===
  slabControls = createSlabControls();
  panel.appendChild(slabControls);

  // === Box tool controls ===
  boxControls = createBoxControls();
  panel.appendChild(boxControls);

  // === Region list ===
  const regionList = document.createElement('div');
  regionList.id = 'paint-region-list';
  regionList.className = 'mt-2 border-t border-zinc-700 pt-2 max-h-32 overflow-y-auto';
  panel.appendChild(regionList);

  onRegionsChange(() => updateRegionList(regionList));

  // === Action row ===
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700 flex-wrap';

  visibilityBtn = document.createElement('button');
  visibilityBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
  visibilityBtn.title = 'Toggle all paint region visibility in viewport (exports keep colors regardless)';
  visibilityBtn.addEventListener('click', () => { setPaintVisible(!isPaintVisible()); });
  actions.appendChild(visibilityBtn);

  undoBtn = document.createElement('button');
  undoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Remove the most recent paint region';
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', () => { removeLastRegion(); });
  actions.appendChild(undoBtn);

  redoBtn = document.createElement('button');
  redoBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Restore the most recently undone paint region';
  redoBtn.disabled = true;
  redoBtn.addEventListener('click', () => { redoLastRegion(); });
  actions.appendChild(redoBtn);

  undoClearBtn = document.createElement('button');
  undoClearBtn.className = 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors opacity-40 cursor-not-allowed';
  undoClearBtn.textContent = 'Undo clear';
  undoClearBtn.title = 'Restore all regions removed by the last Clear (only available until the next paint)';
  undoClearBtn.disabled = true;
  undoClearBtn.addEventListener('click', () => { undoClear(); });
  actions.appendChild(undoClearBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-2 py-1 rounded text-[10px] bg-red-700/60 text-red-200 hover:bg-red-600/60 transition-colors';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Remove all paint regions';
  clearBtn.addEventListener('click', () => { clearRegions(); });
  actions.appendChild(clearBtn);

  panel.appendChild(actions);

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
  for (const sync of shapeSmoothSyncs) sync();
}

function createBucketControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-2 pt-2 border-t border-zinc-700';

  const label = document.createElement('div');
  label.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
  label.textContent = 'Bucket tolerance';
  wrap.appendChild(label);

  // Slider 0..100 maps to angle 0\u00B0..180\u00B0 (where tolerance = cos(angle)).
  // Number input is the same angle in degrees, two-way synced with the slider
  // so users who already know the angle they want (e.g. 5\u00B0) can just type it.
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(toleranceToSliderPct(getBucketTolerance()));
  slider.className = 'flex-1 accent-blue-500 min-w-0';
  slider.title = 'Maximum bend angle (0\u00B0\u2013180\u00B0) between adjacent faces the flood-fill is allowed to cross';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '180';
  input.step = '0.1';
  input.value = toleranceToAngleDeg(getBucketTolerance()).toFixed(1);
  input.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  input.title = 'Bend angle in degrees (0\u2013180)';

  const unit = document.createElement('span');
  unit.className = 'text-[10px] text-zinc-500';
  unit.textContent = '\u00B0';

  slider.addEventListener('input', () => {
    const tol = sliderPctToTolerance(parseInt(slider.value, 10));
    setBucketTolerance(tol);
    input.value = toleranceToAngleDeg(tol).toFixed(1);
  });

  const applyAngle = (): void => {
    const raw = parseFloat(input.value);
    if (!Number.isFinite(raw)) {
      input.value = toleranceToAngleDeg(getBucketTolerance()).toFixed(1);
      return;
    }
    const angle = Math.max(0, Math.min(180, raw));
    const tol = Math.cos(angle * Math.PI / 180);
    setBucketTolerance(tol);
    slider.value = String(toleranceToSliderPct(tol));
    input.value = angle.toFixed(1);
  };
  input.addEventListener('change', applyAngle);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyAngle(); input.blur(); } });

  row.appendChild(slider);
  row.appendChild(input);
  row.appendChild(unit);
  wrap.appendChild(row);

  const help = document.createElement('div');
  help.className = 'text-[10px] text-zinc-500 mt-1';
  help.textContent = 'Coplanar only \u2190\u2014\u2014\u2192 Whole connected mesh';
  wrap.appendChild(help);

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

function toleranceToSliderPct(tol: number): number {
  // Slider 0..100 maps to angle 0°..180° (i.e. tol = cos(angle)).
  // 0 = strict (only exactly-coplanar adjacent faces);
  // 100 = no limit (paints the whole connected component).
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

function updateActiveSwatch(grid: HTMLElement, activeSwatch: HTMLElement): void {
  for (const child of Array.from(grid.children)) {
    (child as HTMLElement).classList.remove('border-white/80', 'ring-1', 'ring-white/30');
  }
  activeSwatch.classList.add('border-white/80', 'ring-1', 'ring-white/30');
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

    const dot = document.createElement('span');
    dot.className = 'w-3 h-3 rounded-sm shrink-0';
    dot.style.backgroundColor = rgbToCSS(region.color);
    if (!region.visible) dot.classList.add('opacity-30');

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
    pickerPanel?.classList.add('hidden');
  }
}

/** True if the paint menu is open (paint mode is active). */
export function isPaintOpen(): boolean {
  return isActive();
}
