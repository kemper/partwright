// Surface modifiers UI — a floating panel for applying fuzzy skin, smooth/round,
// and voxelize to the current model. It drives the public console API
// (`partwright.applyFuzzySkin` / `smoothModel` / `voxelizeModel`), so the modal
// stays decoupled from the editor internals; each apply produces a new version
// exactly as if the user had typed and run the equivalent code (so undo/redo is
// just the app's version history).
//
// Preview is non-destructive: it swaps the viewport mesh via
// `previewSurfaceModifier` without running the engine or saving a version, and
// is cleared (`clearSurfacePreview`) on close/cancel/tab-switch. Slider changes
// trigger a debounced auto-preview; an explicit "Preview" button forces one.

import { registerCommands } from './commandPalette';
import { getConfig } from '../config/appConfig';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';
import { TOOL_PANEL_CLASS, TOOL_PANEL_HEADER, TOOL_PANEL_TITLE, TOOL_PANEL_CLOSE } from './toolPanel';
import { pickFace } from '../color/facePicker';
import { addPointerSuppressor, getCanvas } from '../renderer/viewport';
import { showEngraveOutline, hideEngraveOutline, disposeEngraveOutline } from '../surface/engravePlacementOverlay';
import { buildAdjacency, findConnectedFromSeed } from '../color/adjacency';
import { getCurrentMesh, previewTriangles } from '../color/paintMode';
import { buildTriColors } from '../color/regions';
import type { StampMask, EngraveProjection } from '../surface/modifiers';
import { engravePlanarFootprint, engraveFreeFootprint } from '../surface/engraveStamp';
import { listFilaments } from '../color/palette';
import { createColorSwatch } from './colorPickerModal';

type ApplyResult = { error?: string; label?: string } | Record<string, unknown>;
type ModId = 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi' | 'voronoiLamp' | 'engrave' | 'smooth' | 'voxelize';

/** The subset of the console API the surface UI needs. */
export interface SurfaceApi {
  applyFuzzySkin(opts?: { amplitude?: number; scale?: number; octaves?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyKnitTexture(opts?: { amplitude?: number; stitchWidth?: number; stitchHeight?: number; rowOffset?: number; roundness?: number; grainAngleDeg?: number; variation?: number; seed?: number; quality?: number; algorithm?: 'bfs' | 'lscm' | 'harmonic'; selectedTriangles?: Set<number>; preserveColor?: boolean }): Promise<ApplyResult>;
  applyCableKnit(opts?: { amplitude?: number; cableWidth?: number; cablePitch?: number; plyWidth?: number; grainAngleDeg?: number; variation?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyWaffleStitch(opts?: { amplitude?: number; cellWidth?: number; cellHeight?: number; sharpness?: number; rowOffset?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyFurVelvet(opts?: { amplitude?: number; fiberSpacing?: number; fiberLength?: number; octaves?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyWovenFabric(opts?: { amplitude?: number; threadSpacing?: number; threadWidth?: number; underDepth?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyKnurlTexture(opts?: { amplitude?: number; cellWidth?: number; cellHeight?: number; style?: 'diamond' | 'straight' | 'ribs'; profile?: 'round' | 'pyramid'; sharpness?: number; grainAngleDeg?: number; seed?: number; quality?: number; selectedTriangles?: Set<number>; preserveColor?: boolean }): Promise<ApplyResult>;
  applyVoronoiShell(opts?: { amplitude?: number; cellSize?: number; wallWidth?: number; raised?: boolean; jitter?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyVoronoiLamp(opts?: { cellSize?: number; wallThickness?: number; strutWidth?: number; resolution?: number; jitter?: number; grainAngleDeg?: number; seed?: number; smooth?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  buildEngraveStamp(spec?: { text?: string; font?: 'regular' | 'bold' | 'italic' | 'bold-italic'; imageUrl?: string; invert?: boolean }): Promise<{ mask: StampMask; width: number; height: number } | { error: string }>;
  engraveModel(opts?: { mask?: StampMask; source?: string; projection?: EngraveProjection; through?: boolean; raised?: boolean; depth?: number; size?: number; color?: string; resolution?: number; watertight?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  smoothModel(opts?: { iterations?: number; subdivide?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  voxelizeModel(opts?: { resolution?: number; smooth?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  /** Write the texture into the code as `api.surface.<id>({…})` instead of
   *  baking (manifold-js sessions, whole-model mode). Re-runs + saves a version.
   *  `opts` may carry a `label` or `region` scope (objects) alongside scalars. */
  applySurfaceTextureAsCode(id: string, opts?: Record<string, unknown>): Promise<ApplyResult>;
  /** Names of the current model's `api.label(...)` regions, for the code-path
   *  scope picker's label dropdown. Empty when the model declares none. */
  getLabelNames(): string[];
  /** Apply any pending (cancelled/failed) in-code texture chain so previews
   *  run on the textured mesh. No-op when nothing is pending. */
  ensureSurfaceTexturesApplied(): Promise<{ ok: boolean }>;
  previewSurfaceModifier(id: ModId, opts?: Record<string, unknown>, preserveColor?: boolean): Promise<{ ok: true } | { error: string }>;
  clearSurfacePreview(): { ok: true };
  modelHasColor(): boolean;
  getActiveLanguage(): string;
  getGeometryData(): { boundingBox?: { min?: number[]; max?: number[] } | null } | Record<string, unknown>;
}

type Tab = ModId;

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

let openModal: HTMLDivElement | null = null;
let currentSurfaceClose: (() => void) | null = null;

const surfaceRegistryEntry = { close(): void { currentSurfaceClose?.(); } };

function onSurfaceEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  currentSurfaceClose?.();
}

/** Current model's largest bbox dimension, for size-relative slider ranges. */
function modelSpan(api: SurfaceApi): number {
  const s = modelBBox(api).size;
  const m = Math.max(s[0], s[1], s[2]);
  return Number.isFinite(m) && m > 0 ? m : 10;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A labeled range slider with a live numeric readout. `onChange` fires on input. */
function slider(label: string, min: number, max: number, value: number, step: number, fmt: (n: number) => string, onChange: () => void) {
  const wrap = el('label', 'block mb-3 text-xs text-zinc-300');
  const head = el('div', 'flex justify-between mb-1');
  head.append(el('span', '', label));
  const readout = el('span', 'text-zinc-400 tabular-nums', fmt(value));
  head.append(readout);
  const input = el('input', 'w-full accent-blue-500');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.addEventListener('input', () => { readout.textContent = fmt(input.valueAsNumber); onChange(); });
  wrap.append(head, input);
  return { wrap, get: () => input.valueAsNumber };
}

/** A range slider paired with a numeric text box. The text box accepts values
 *  beyond the slider's max — up to `hardMax` — so power users can type a higher
 *  value than the slider exposes (the thumb just pins at `sliderMax`).
 *  `get()` returns the text box value, clamped to [min, hardMax]. By default the
 *  value is rounded to a whole number (resolution); pass `round` to keep a
 *  fractional value (text size / engrave depth) — e.g. snap to the step. */
function sliderWithEntry(
  label: string, min: number, sliderMax: number, value: number, step: number,
  hardMax: number, onChange: () => void,
  opts: { round?: (n: number) => number } = {},
) {
  const round = opts.round ?? Math.round;
  const wrap = el('label', 'block mb-3 text-xs text-zinc-300');
  const head = el('div', 'flex justify-between mb-1 items-center gap-2');
  head.append(el('span', '', label));
  const num = el('input', 'w-20 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-right tabular-nums text-zinc-200');
  num.type = 'number';
  num.min = String(min); num.max = String(hardMax); num.step = String(step);
  num.value = String(value);
  head.append(num);
  const range = el('input', 'w-full accent-blue-500');
  range.type = 'range';
  range.min = String(min); range.max = String(sliderMax); range.step = String(step);
  range.value = String(Math.min(value, sliderMax));
  const clamp = (n: number) => Math.max(min, Math.min(hardMax, round(n)));
  range.addEventListener('input', () => { num.value = String(round(range.valueAsNumber)); onChange(); });
  num.addEventListener('input', () => {
    const raw = num.valueAsNumber;
    if (Number.isNaN(raw)) return;            // mid-edit empty box — don't snap yet
    range.value = String(Math.max(min, Math.min(sliderMax, raw)));
    onChange();
  });
  // On commit (blur / Enter) normalize the box to the clamped value.
  num.addEventListener('change', () => { num.value = String(clamp(num.valueAsNumber || min)); onChange(); });
  wrap.append(head, range);
  return { wrap, get: () => clamp(num.valueAsNumber || min) };
}

/** A 0–100% position slider with quick-snap buttons at 0/25/50/75/100% — the
 *  detents the engrave placement uses to drop text at the quarter points. */
function sliderWithSnaps(label: string, value: number, onChange: () => void) {
  const wrap = el('label', 'block mb-3 text-xs text-zinc-300');
  const head = el('div', 'flex justify-between mb-1');
  head.append(el('span', '', label));
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const readout = el('span', 'text-zinc-400 tabular-nums', pct(value));
  head.append(readout);
  const input = el('input', 'w-full accent-blue-500');
  input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = String(value);
  input.addEventListener('input', () => { readout.textContent = pct(input.valueAsNumber); onChange(); });
  const snaps = el('div', 'flex gap-1 mt-1');
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const b = el('button', 'flex-1 px-1 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 hover:bg-zinc-700', pct(f));
    b.type = 'button';
    b.addEventListener('click', () => { input.value = String(f); readout.textContent = pct(f); onChange(); });
    snaps.append(b);
  }
  wrap.append(head, input, snaps);
  return { wrap, get: () => input.valueAsNumber, set: (v: number) => { input.value = String(v); readout.textContent = pct(v); } };
}

/** In-plane axis indices for a planar face normal axis (mirrors engraveStamp's
 *  PLANE_AXES so click-placement fractions line up with the field math). */
const ENGRAVE_PLANE_AXES: Record<'x' | 'y' | 'z', [number, number]> = { z: [0, 1], y: [0, 2], x: [1, 2] };

type Vec3 = [number, number, number];
/** A committed engrave placement. `planar` snaps to an axis-aligned face (the
 *  position sliders + quarter-snaps apply); `free` lies flat on an arbitrary
 *  clicked surface point (sloped/curved faces) — positioned by clicking. */
type EngravePlacement =
  | { mode: 'planar'; axis: 'x' | 'y' | 'z'; side: 'min' | 'max'; posU: number; posV: number; rot: number }
  | { mode: 'free'; origin: Vec3; normal: Vec3; rot: number };

/** Current model bbox (min/max/size) for placement fractions and slider ranges;
 *  a safe default if geometry data is unavailable. Handles both bbox shapes the
 *  geometry data has used: the stats form `{x:[lo,hi], y, z}` that
 *  `getGeometryData()` actually returns, and the legacy `{min, max}` form. */
function modelBBox(api: SurfaceApi): { min: number[]; max: number[]; size: number[] } {
  try {
    const gd = api.getGeometryData() as {
      boundingBox?: { min?: number[]; max?: number[]; x?: number[]; y?: number[]; z?: number[] } | null;
    };
    const bb = gd?.boundingBox;
    let min: number[] | undefined, max: number[] | undefined;
    if (bb?.x && bb?.y && bb?.z) {
      min = [bb.x[0], bb.y[0], bb.z[0]];
      max = [bb.x[1], bb.y[1], bb.z[1]];
    } else if (bb?.min && bb?.max && bb.min.length >= 3 && bb.max.length >= 3) {
      min = bb.min; max = bb.max;
    }
    if (min && max && min.every(Number.isFinite) && max.every(Number.isFinite)) {
      return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
    }
  } catch { /* fall through */ }
  return { min: [-5, -5, -5], max: [5, 5, 5], size: [10, 10, 10] };
}

/** Human label for a planar face (axis + side). */
function engraveFaceLabel(axis: 'x' | 'y' | 'z', side: 'min' | 'max'): string {
  const map: Record<string, string> = {
    'z+': 'Top (+Z)', 'z-': 'Bottom (−Z)', 'y-': 'Front (−Y)', 'y+': 'Back (+Y)', 'x+': 'Right (+X)', 'x-': 'Left (−X)',
  };
  return map[`${axis}${side === 'max' ? '+' : '-'}`] ?? `${axis}${side}`;
}

function checkbox(label: string, checked: boolean, onChange: () => void) {
  const wrap = el('label', 'flex items-center gap-2 mb-3 text-xs text-zinc-300 cursor-pointer');
  const input = el('input', 'accent-blue-500');
  input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', onChange);
  wrap.append(input, el('span', '', label));
  return { wrap, get: () => input.checked };
}

/** A labeled <select> dropdown. `options` is [value, label] pairs. */
function dropdown<T extends string>(
  label: string,
  options: [T, string][],
  value: T,
  onChange: () => void,
) {
  const wrap = el('label', 'block mb-3 text-xs text-zinc-300');
  wrap.append(el('div', 'mb-1', label));
  const sel = el('select', 'w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100');
  for (const [v, lbl] of options) {
    const o = el('option', '', lbl);
    o.value = v;
    if (v === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', onChange);
  wrap.append(sel);
  return { wrap, get: () => sel.value as T };
}

/** Normalize any hex form to the `#rrggbb` a native colour input requires. */
function toColorInputHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : '#d4af37';
}

/** A colour control that mirrors the paint tools: the shared filament palette as
 *  a swatch grid (click to pick a slot) plus the shared palette picker for an
 *  off-palette colour. Returns the current hex via `get()`. `onChange` fires on every pick.
 *  Snapshots the palette at creation — the panel is short-lived, so it doesn't
 *  subscribe to live palette edits the way the persistent paint drawer does. */
function colorField(initial: string, onChange: () => void) {
  const wrap = el('div', 'mb-3');
  let value = toColorInputHex(initial);

  const grid = el('div', 'grid grid-cols-6 gap-1.5 mb-2');
  const swatches: { btn: HTMLButtonElement; hex: string }[] = [];
  const syncRings = () => {
    for (const s of swatches) {
      const on = toColorInputHex(s.hex) === value;
      s.btn.classList.toggle('border-white/80', on);
      s.btn.classList.toggle('ring-1', on);
      s.btn.classList.toggle('ring-white/30', on);
      s.btn.classList.toggle('border-transparent', !on);
    }
  };

  // Off-palette custom colour — opens the shared palette picker. Declared before
  // the quick-pick grid so the grid's click handlers can sync the swatch.
  const pickerSwatch = createColorSwatch({
    initialHex: value,
    title: 'Custom colour',
    modalTitle: 'Custom colour',
    className: 'w-6 h-6 shrink-0 rounded cursor-pointer border border-zinc-500 hover:border-white/70 transition-colors',
    onPick: (hex) => { value = toColorInputHex(hex); pickerSwatch.setHex(value); syncRings(); onChange(); },
  });

  for (const f of listFilaments()) {
    const btn = el('button', 'w-6 h-6 rounded border-2 border-transparent hover:border-white/50 transition-colors');
    btn.type = 'button';
    btn.style.backgroundColor = f.hex;
    btn.title = `${f.name} (${f.hex})`;
    btn.addEventListener('click', () => {
      value = toColorInputHex(f.hex);
      pickerSwatch.setHex(value);
      syncRings();
      onChange();
    });
    swatches.push({ btn, hex: f.hex });
    grid.append(btn);
  }

  const customRow = el('label', 'flex items-center gap-1.5');
  customRow.append(pickerSwatch.el, el('span', 'text-[10px] text-zinc-500', 'Custom colour'));

  wrap.append(grid, customRow);
  syncRings();
  return { wrap, get: () => value };
}

/** Find the viewport container used by the other overlay panels. */
function getViewportContainer(): HTMLElement {
  return (document.getElementById('clip-controls')?.offsetParent as HTMLElement | null) ?? document.body;
}

export function openSurfaceModal(api: SurfaceApi, initialTab: Tab = 'fuzzy'): void {
  if (openModal) { openModal.remove(); openModal = null; currentSurfaceClose = null; }
  const span = modelSpan(api);
  const painted = (() => { try { return api.modelHasColor(); } catch { return false; } })();

  const container = getViewportContainer();

  // Floating panel — absolutely positioned inside the viewport container.
  const panel = el('div', `${TOOL_PANEL_CLASS} text-zinc-100 w-[min(94vw,400px)] max-h-[calc(100%-3.5rem)] select-none`) as HTMLDivElement;

  // Header — drag handle + title + × button (shared tool-panel chrome).
  const header = el('div', TOOL_PANEL_HEADER);
  header.append(el('h2', TOOL_PANEL_TITLE, 'Surface modifiers'));
  const closeBtn = el('button', TOOL_PANEL_CLOSE, '×');
  closeBtn.setAttribute('aria-label', 'Close surface panel');
  header.append(closeBtn);
  panel.append(header);
  const dragHandle = attachViewportPanelDrag(header, panel);

  // Scrollable body.
  const scrollBody = el('div', 'overflow-y-auto flex-1 p-4 max-h-[min(80vh,30rem)]');
  panel.append(scrollBody);

  scrollBody.append(el('p', 'text-[11px] text-zinc-500 mb-3', 'Previews live in the viewport; Apply saves a new version (undo via version history).'));

  // Tab strip — wraps to a second line when there are too many to fit on one row.
  const tabRow = el('div', 'flex flex-wrap gap-1 mb-4');
  const body = el('div', '');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'fuzzy', label: 'Fuzzy' },
    { id: 'knit', label: 'Knit' },
    { id: 'cable', label: 'Cable' },
    { id: 'waffle', label: 'Waffle' },
    { id: 'fur', label: 'Fur' },
    { id: 'woven', label: 'Woven' },
    { id: 'knurl', label: 'Knurl' },
    { id: 'voronoi', label: 'Voronoi (relief)' },
    { id: 'voronoiLamp', label: 'Voronoi lamp' },
    { id: 'engrave', label: 'Engrave' },
    { id: 'smooth', label: 'Smooth' },
    { id: 'voxelize', label: 'Voxelize' },
  ];
  let active: Tab = initialTab;

  // --- Engrave stamp state — the rasterized ink mask the field math consumes.
  // Built async from the text/image inputs (font fetch + raster), then reused
  // for every preview/apply until those inputs change. ---
  let engraveMask: StampMask | null = null;
  let engraveSource = '';      // text string or 'image' — labels the version
  let engraveBuilding = false; // a rebuild is in flight (suppresses preview)
  // Planar placement (persisted across tab re-renders): which face, the stamp
  // center as a fraction of the bbox on the two in-plane axes, and in-plane
  // rotation. Set by the position sliders or by clicking the model.
  // Current placement: planar (axis-aligned, slider-driven) or free (lies on a
  // clicked sloped/curved face). `placed` flips once the user has clicked once.
  const engravePlace = {
    mode: 'planar' as 'planar' | 'free',
    axis: 'z' as 'x' | 'y' | 'z', side: 'max' as 'min' | 'max', posU: 0.5, posV: 0.5,
    origin: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3,
    rot: 0, placed: false,
    // Optional curvature: bend the flat stamp around its own vertical ('v') or
    // horizontal ('u') axis so it wraps a cylinder/dome; 'none' = flat.
    curveAxis: 'none' as 'none' | 'u' | 'v', curveAngle: 90,
  };
  /** Snapshot the mutable state as a typed, discriminated placement. */
  const currentPlacement = (): EngravePlacement => engravePlace.mode === 'free'
    ? { mode: 'free', origin: engravePlace.origin, normal: engravePlace.normal, rot: engravePlace.rot }
    : { mode: 'planar', axis: engravePlace.axis, side: engravePlace.side, posU: engravePlace.posU, posV: engravePlace.posV, rot: engravePlace.rot };
  let engravePickStop: (() => void) | null = null; // active click-to-place suppressor
  // Live control refs the click-to-place handler updates (set by renderTab).
  let engravePosX: { set: (v: number) => void } | null = null;
  let engravePosY: { set: (v: number) => void } | null = null;
  let engravePosWraps: HTMLElement[] = []; // the position sliders' wrappers (hidden in free mode)
  let engravePlaceNote: HTMLElement | null = null; // "positioned by click" note for free mode
  let engraveFaceReadout: HTMLElement | null = null;
  let engravePlaceBtn: HTMLButtonElement | null = null;
  let engraveSizeGet: (() => number) | null = null; // current text-size slider value
  let engraveIsPlanar: (() => boolean) | null = null; // projection mode == planar
  let engravePointerMove: ((e: PointerEvent) => void) | null = null; // hover listener while placing

  const status = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mb-2');

  // --- Color handling (shared across tabs) ---
  // Default to preserve; the toggle lets the user clear instead. The warning
  // only shows when the model is actually painted.
  let preserveColor = true;

  // --- Region selector state (persists across tab switches) ---
  let regionSelection: Set<number> | null = null;
  let regionTeardown: (() => void) | null = null;
  let selectionSuppressor: (() => void) | null = null;
  let inSelectionMode = false;
  let seedTriangles: number[] = [];          // all seeds clicked so far
  let regionMode: 'region' | 'whole' = 'region'; // default: region mode

  // --- Region selector UI (created once, moved above tabs) ---

  // Mode toggle: Region | Whole model
  const MODE_ACTIVE = 'px-2.5 py-1 rounded text-xs bg-blue-600 text-white';
  const MODE_IDLE   = 'px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
  const modeRegionBtn = el('button', MODE_ACTIVE, 'Region');
  const modeWholeBtn  = el('button', MODE_IDLE, 'Whole model');
  const modeRow = el('div', 'flex gap-1 mb-2');
  modeRow.append(modeRegionBtn, modeWholeBtn);

  // Cursor-arrow icon for the pick-regions toggle
  const PICK_ICON_SVG = `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672Zm-7.518-.267A8.25 8.25 0 1 1 20.25 10.5M8.288 14.212A5.25 5.25 0 1 1 17.25 10.5"/></svg>`;
  const SEL_IDLE   = BTN_BASE + ' flex items-center gap-1.5';
  const SEL_ACTIVE = 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-blue-700 text-white border border-blue-500 ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-800';
  const selectingBtn = el('button', SEL_IDLE);
  selectingBtn.innerHTML = PICK_ICON_SVG + '<span>Pick regions</span>';
  selectingBtn.title = 'Click faces on the model to flood-fill select regions';

  const clearAllBtn = el('button', 'text-xs text-zinc-500 hover:text-zinc-300 px-1');
  clearAllBtn.textContent = 'Clear all';
  clearAllBtn.disabled = true;
  const regionBtns = el('div', 'flex items-center gap-3 mb-1');
  regionBtns.append(selectingBtn, clearAllBtn);

  const regionStatus = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mt-1 mb-1');
  regionStatus.textContent = 'Pick at least one region to preview.';

  const spreadSlider    = slider('Spread', 10, 80, 45, 5, n => n + '°', () => scheduleReselect());
  const colorSensSlider = slider('Color sensitivity', 0, 100, 0, 5, n => n + '%', () => scheduleReselect());

  const regionControls = el('div', '');
  regionControls.append(regionBtns, regionStatus, spreadSlider.wrap, colorSensSlider.wrap);

  const regionSection = el('div', 'mb-3 pb-3 border-b border-zinc-700/50');
  regionSection.append(
    el('div', 'text-[11px] text-zinc-500 uppercase tracking-wide mb-2', 'Region'),
    modeRow,
    regionControls,
  );

  // --- Code-path scope UI (whole-model "apply as code" only) ---
  // Limits an api.surface.* call to part of the model: a labeled shape, or a
  // patch around a clicked point. Shown only when Apply writes code.
  type CodeScope =
    | { kind: 'none' }
    | { kind: 'label'; label: string }
    | { kind: 'point'; point: [number, number, number]; radius: number };
  let codeScope: CodeScope = { kind: 'none' };
  let scopePickSuppressor: (() => void) | null = null;

  const SCOPE_ON = 'px-2.5 py-1 rounded text-xs bg-blue-600 text-white';
  const SCOPE_OFF = 'px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
  const scopeWholeBtn = el('button', SCOPE_ON, 'Whole');
  const scopeLabelBtn = el('button', SCOPE_OFF, 'By label');
  const scopePointBtn = el('button', SCOPE_OFF, 'Near point');
  const scopeBtnRow = el('div', 'flex gap-1 mb-2');
  scopeBtnRow.append(scopeWholeBtn, scopeLabelBtn, scopePointBtn);

  const scopeLabelSelect = el('select', 'w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200') as HTMLSelectElement;
  scopeLabelSelect.setAttribute('aria-label', 'Scope label');
  const scopeLabelRow = el('div', 'mb-1');
  scopeLabelRow.append(scopeLabelSelect);

  const scopePickBtn = el('button', BTN_BASE, 'Pick point on model');
  const scopeRadius = slider('Region radius', 1, Math.max(2, Math.round(modelSpan(api))), Math.max(1, Math.round(modelSpan(api) * 0.25)), 1, n => String(n), () => {
    if (codeScope.kind === 'point') { codeScope = { ...codeScope, radius: scopeRadius.get() }; schedulePreview(); }
  });
  const scopePointStatus = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mt-1');
  const scopePointRow = el('div', 'mb-1');
  scopePointRow.append(scopePickBtn, scopeRadius.wrap, scopePointStatus);

  const codeScopeSection = el('div', 'mb-3 pb-3 border-b border-zinc-700/50');
  codeScopeSection.append(
    el('div', 'text-[11px] text-zinc-500 uppercase tracking-wide mb-2', 'Scope'),
    scopeBtnRow,
    scopeLabelRow,
    scopePointRow,
  );
  codeScopeSection.style.display = 'none';

  function stopScopePick(): void {
    scopePickSuppressor?.();
    scopePickSuppressor = null;
    document.body.style.cursor = '';
    scopePickBtn.textContent = 'Pick point on model';
  }

  /** Scope keys to merge into the apply-as-code options (empty unless scoped). */
  function scopeOpts(): Record<string, unknown> {
    if (!applyWritesCode()) return {};
    if (codeScope.kind === 'label') return { label: codeScope.label };
    if (codeScope.kind === 'point') return { region: { point: codeScope.point, radius: codeScope.radius } };
    return {};
  }

  function updateScopeUI(): void {
    scopeWholeBtn.className = codeScope.kind === 'none' ? SCOPE_ON : SCOPE_OFF;
    scopeLabelBtn.className = codeScope.kind === 'label' ? SCOPE_ON : SCOPE_OFF;
    scopePointBtn.className = codeScope.kind === 'point' ? SCOPE_ON : SCOPE_OFF;
    // Keep the sub-controls visible while a mode is selected (even before a
    // label/point is chosen).
    scopeLabelRow.style.display = codeScope.kind === 'label' || labelMode ? '' : 'none';
    scopePointRow.style.display = codeScope.kind === 'point' || pointMode ? '' : 'none';
    if (codeScope.kind === 'point') {
      const [x, y, z] = codeScope.point;
      scopePointStatus.textContent = `Point (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) · radius ${codeScope.radius}`;
    } else if (pointMode) {
      scopePointStatus.textContent = 'Click a point on the model to set the region center.';
    }
  }

  // Track which mode button is selected even before a value is chosen, so the
  // sub-controls (label dropdown / point picker) stay visible while choosing.
  let labelMode = false;
  let pointMode = false;

  function setScopeMode(mode: 'none' | 'label' | 'point'): void {
    stopScopePick();
    labelMode = mode === 'label';
    pointMode = mode === 'point';
    if (mode === 'none') {
      codeScope = { kind: 'none' };
    } else if (mode === 'label') {
      const names = (() => { try { return api.getLabelNames(); } catch { return []; } })();
      scopeLabelSelect.innerHTML = '';
      if (names.length === 0) {
        const o = el('option', '', 'No api.label() regions in this model') as HTMLOptionElement;
        o.disabled = true; o.selected = true;
        scopeLabelSelect.append(o);
        codeScope = { kind: 'none' };
      } else {
        for (const n of names) scopeLabelSelect.append(el('option', '', n) as HTMLOptionElement);
        codeScope = { kind: 'label', label: names[0] };
      }
    } else {
      codeScope = { kind: 'none' }; // becomes a point once the user clicks
    }
    updateScopeUI();
  }

  // Each scope change re-fires the (debounced) preview so the scoped patch shown
  // in the viewport tracks the picker — matching what Apply will write.
  scopeWholeBtn.addEventListener('click', () => { setScopeMode('none'); schedulePreview(); });
  scopeLabelBtn.addEventListener('click', () => { setScopeMode('label'); schedulePreview(); });
  scopePointBtn.addEventListener('click', () => { setScopeMode('point'); schedulePreview(); });
  scopeLabelSelect.addEventListener('change', () => {
    if (scopeLabelSelect.value) { codeScope = { kind: 'label', label: scopeLabelSelect.value }; schedulePreview(); }
  });
  scopePickBtn.addEventListener('click', () => {
    if (scopePickSuppressor) { stopScopePick(); updateScopeUI(); return; }
    document.body.style.cursor = 'crosshair';
    scopePickBtn.textContent = 'Click the model…';
    scopePickSuppressor = addPointerSuppressor((evt: PointerEvent) => {
      if (evt.type !== 'pointerdown') return false;
      const hit = pickFace(evt as MouseEvent);
      if (!hit) return true; // empty space — keep listening, veto orbit
      codeScope = { kind: 'point', point: hit.point, radius: scopeRadius.get() };
      stopScopePick();
      updateScopeUI();
      schedulePreview();
      return true;
    });
  });

  // Modifiers expressible as in-code `api.surface.*` calls. voxelize/voronoiLamp
  // change engines and engrave is a boolean cut, so they stay bake-only.
  const IN_CODE_IDS = new Set<Tab>(['fuzzy', 'knit', 'cable', 'waffle', 'fur', 'woven', 'knurl', 'voronoi', 'smooth']);
  // Tabs that hide the region picker entirely (always whole-model).
  const REGIONLESS_TABS = new Set<Tab>(['voxelize', 'voronoiLamp', 'engrave']);

  /** Returns the effective selectedTriangles for currentOpts(). */
  function activeSelection(): Set<number> | undefined {
    return regionMode === 'region' ? regionSelection ?? undefined : undefined;
  }

  /** Whether Apply/preview should be blocked (region mode, nothing picked yet).
   *  Tabs that hide the region UI (voxelize/voronoiLamp) are always whole-model,
   *  so a lingering empty region selection must not dead-lock them. */
  function regionBlocked(): boolean {
    if (REGIONLESS_TABS.has(active)) return false;
    return regionMode === 'region' && !regionSelection;
  }

  /** True when Apply will write an `api.surface.*` call into the code instead
   *  of baking: an in-code-able modifier, applied to the whole model, in a
   *  manifold-js session. Region/patch applies and SCAD/BREP/voxel sessions
   *  keep the bake path (api.surface.* is whole-model, manifold-js only). */
  function applyWritesCode(): boolean {
    if (!IN_CODE_IDS.has(active)) return false;
    if (regionMode !== 'whole') return false;
    try { return api.getActiveLanguage() === 'manifold-js'; } catch { return false; }
  }

  function updateApplyBtn() {
    const blocked = regionBlocked();
    const asCode = applyWritesCode();
    // The scope picker only applies on the code path; hide it (and drop any
    // pending pick) when Apply would bake.
    codeScopeSection.style.display = asCode ? '' : 'none';
    if (!asCode && scopePickSuppressor) stopScopePick();
    applyBtn.textContent = asCode ? 'Apply as code' : 'Apply (bake)';
    pathHint.textContent = asCode
      ? `Adds api.surface.${active}(…) to your code — stays parametric, recomputes with the model.`
      : REGIONLESS_TABS.has(active)
        ? 'Saves a new version with the result baked in (the parametric code is replaced).'
        : 'Bakes the textured mesh into a new version (the parametric code is replaced). Whole-model textures in JS sessions apply as code instead.';
    applyBtn.disabled = blocked;
    applyBtn.className = blocked
      ? 'px-3 py-1.5 rounded bg-blue-900/40 text-blue-300/40 text-xs font-medium cursor-not-allowed'
      : 'px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium';
    previewBtn.disabled = blocked;
    previewBtn.className = blocked
      ? 'px-3 py-1.5 rounded bg-zinc-800/40 text-zinc-400/40 text-xs cursor-not-allowed'
      : 'px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs';
  }

  function reapplySelectionOverlay() {
    if (regionSelection && regionMode === 'region') {
      regionTeardown?.();
      regionTeardown = previewTriangles(regionSelection, [0.9, 0.7, 0.1]);
    }
  }

  function exitSelectionMode() {
    if (!inSelectionMode) return;
    inSelectionMode = false;
    selectionSuppressor?.();
    selectionSuppressor = null;
    document.body.style.cursor = '';
    selectingBtn.className = SEL_IDLE;
    selectingBtn.innerHTML = PICK_ICON_SVG + '<span>Pick regions</span>';
  }

  function updateRegionStatus() {
    const count = regionSelection?.size ?? 0;
    const seeds = seedTriangles.length;
    if (count === 0) {
      regionStatus.textContent = 'Pick at least one region to preview.';
      regionStatus.className = 'text-[11px] text-blue-400/80 min-h-[1rem] mt-1 mb-1';
    } else {
      const regionWord = seeds === 1 ? 'region' : 'regions';
      const suffix = inSelectionMode ? ' — click to add more' : '';
      regionStatus.textContent = `${count.toLocaleString()} triangles (${seeds} ${regionWord})${suffix}`;
      regionStatus.className = 'text-[11px] text-zinc-400 min-h-[1rem] mt-1 mb-1';
    }
    updateApplyBtn();
  }

  function runFloodFill() {
    const mesh = getCurrentMesh();
    if (!mesh || seedTriangles.length === 0) return;
    const adjacency = buildAdjacency(mesh);
    const maxDevCos = Math.cos((spreadSlider.get() * Math.PI) / 180);
    const colorSens = colorSensSlider.get() / 100;
    const triColors = colorSens > 0 ? buildTriColors(mesh.numTri, false) : null;

    const combined = new Set<number>();
    for (const seed of seedTriangles) {
      const colorOpts = triColors
        ? { triColors, maxColorDist: 1 - colorSens }
        : undefined;
      const tris = findConnectedFromSeed(seed, adjacency, maxDevCos, undefined, colorOpts);
      for (const t of tris) combined.add(t);
    }

    regionTeardown?.();
    regionTeardown = combined.size > 0 ? previewTriangles(combined, [0.9, 0.7, 0.1]) : null;
    regionSelection = combined.size > 0 ? combined : null;
    clearAllBtn.disabled = combined.size === 0;
    updateRegionStatus();
    // No auto-preview here — each selection click would trigger a slow subdivision
    // pass. The user clicks "Preview" explicitly when they're ready to see the result.
  }

  let reselectTimer: number | undefined;
  function scheduleReselect() {
    if (seedTriangles.length === 0) return;
    if (reselectTimer !== undefined) clearTimeout(reselectTimer);
    reselectTimer = window.setTimeout(() => { reselectTimer = undefined; runFloodFill(); }, 150);
  }

  function clearRegion() {
    regionTeardown?.();
    regionTeardown = null;
    regionSelection = null;
    seedTriangles = [];
    clearAllBtn.disabled = true;
    updateRegionStatus();
    clearPreviewIfDirty(); // clearing selection: remove any stale preview, don't fire a new one
  }

  function setRegionMode(mode: 'region' | 'whole') {
    regionMode = mode;
    modeRegionBtn.className = mode === 'region' ? MODE_ACTIVE : MODE_IDLE;
    modeWholeBtn.className  = mode === 'whole'  ? MODE_ACTIVE : MODE_IDLE;
    regionControls.style.display = mode === 'region' ? '' : 'none';
    if (mode === 'whole') exitSelectionMode();
    updateApplyBtn();
    if (mode === 'whole') schedulePreview(); // whole model: auto-preview on mode switch
    else clearPreviewIfDirty();             // region mode: just clear stale preview
  }

  modeRegionBtn.addEventListener('click', () => setRegionMode('region'));
  modeWholeBtn.addEventListener('click',  () => setRegionMode('whole'));

  selectingBtn.addEventListener('click', () => {
    if (inSelectionMode) {
      exitSelectionMode();
      updateRegionStatus();
      // Preview is intentionally NOT fired here — use the Preview button when ready
      return;
    }
    clearPreviewIfDirty();
    inSelectionMode = true;
    selectingBtn.className = SEL_ACTIVE;
    selectingBtn.innerHTML = PICK_ICON_SVG + '<span>Stop picking</span>';
    if (seedTriangles.length === 0) {
      regionStatus.textContent = 'Click the model to add regions…';
      regionStatus.className = 'text-[11px] text-blue-400/80 min-h-[1rem] mt-1 mb-1';
    } else {
      updateRegionStatus();
    }
    document.body.style.cursor = 'crosshair';
    selectionSuppressor = addPointerSuppressor((evt: PointerEvent) => {
      if (evt.type !== 'pointerdown') return false;
      const mesh = getCurrentMesh();
      if (!mesh) return true;
      const hit = pickFace(evt as MouseEvent);
      if (!hit) return true; // empty space — veto orbit, keep listening
      seedTriangles.push(hit.triangleIndex);
      runFloodFill();
      return true;
    });
  });

  clearAllBtn.addEventListener('click', clearRegion);
  const colorRow = el('div', 'mb-3');
  if (painted) {
    const colorBox = checkbox('Preserve colors (best-effort)', true, () => {
      preserveColor = colorBox.get();
      warn.classList.toggle('hidden', preserveColor);
      schedulePreview();
    });
    const warn = el('p', 'hidden text-[11px] text-amber-400/90 mt-1', '⚠ Colors will be cleared by this effect.');
    const note = el('p', 'text-[11px] text-zinc-500 mt-1', 'Voxelize keeps per-voxel color; fuzzy/smooth re-resolve painted regions (brush strokes may not survive re-tessellation).');
    colorRow.append(colorBox.wrap, warn, note);
    // keep reference so the checkbox closure can find `warn` (defined above via hoist).
  }

  // Shared detail slider — persists across texture-tab switches so the user's
  // chosen quality level is preserved when comparing different textures.
  // Not shown for smooth/voxelize (those have their own quality controls).
  const detailLabels = ['Draft', 'Low', 'Medium', 'High', 'Ultra'];
  const detail = slider('Mesh detail', 1, 5, 4, 1, n => detailLabels[n - 1], schedulePreview);

  // Per-tab option getters → modifier options object for preview/apply.
  let currentOpts: () => Record<string, unknown> = () => ({});

  function renderTab() {
    body.innerHTML = '';
    // Leaving any tab stops an in-progress engrave placement and drops stale
    // control refs (the DOM they point at is about to be discarded).
    engravePosX = engravePosY = null; engraveFaceReadout = null; engravePlaceBtn = null;
    engravePosWraps = []; engravePlaceNote = null;
    engraveSizeGet = null; engraveIsPlanar = null;
    exitEngravePick();
    // Switching tabs resets the code-path scope (label sets differ per model,
    // and a point patch is tab-agnostic but clearer to re-pick deliberately).
    setScopeMode('none');
    regionSection.style.display = (active === 'voxelize' || active === 'voronoiLamp' || active === 'engrave') ? 'none' : '';
    if (active === 'fuzzy') {
      const amp = slider('Amplitude (depth)', 0, span * 0.1, span * 0.03, span * 0.001, n => n.toFixed(3), schedulePreview);
      const scale = slider('Feature size', span * 0.005, span * 0.25, span * 0.04, span * 0.005, n => n.toFixed(3), schedulePreview);
      const oct = slider('Detail (octaves)', 1, 4, 2, 1, n => String(n), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(amp.wrap, scale.wrap, oct.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Densifies the mesh, then jitters the surface along its normals — the 3D-print "fuzzy skin" finish.'));
      currentOpts = () => ({ amplitude: amp.get(), scale: scale.get(), octaves: oct.get(), seed: seed.get(), quality: detail.get(), selectedTriangles: activeSelection() });
    } else if (active === 'knit') {
      const sw = slider('Stitch width', span * 0.01, span * 0.25, span * 0.09, span * 0.005, n => n.toFixed(3), schedulePreview);
      const sh = slider('Stitch height', span * 0.01, span * 0.35, span * 0.12, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (depth)', 0, span * 0.15, span * 0.07, span * 0.001, n => n.toFixed(3), schedulePreview);
      const round = slider('Roundness', 0, 1, 0.5, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const variation = slider('Variation', 0, 0.5, 0.1, 0.01, n => n.toFixed(2), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      const algo = dropdown<'bfs' | 'lscm' | 'harmonic'>('UV layout', [
        ['bfs', 'Triangle unfold (fast)'],
        ['lscm', 'Conformal / LSCM'],
        ['harmonic', 'Harmonic field rows'],
      ], 'bfs', schedulePreview);
      body.append(sw.wrap, sh.wrap, amp.wrap, round.wrap, grain.wrap, variation.wrap, seed.wrap, algo.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'V-shaped yarn strands with over-under depth at crossings. UV layout sets how the stitch grid follows the surface: triangle-unfold is fastest; conformal (LSCM) minimizes stitch distortion; harmonic-field gives smooth latitude rows. LSCM/harmonic work best on a selected patch (disk topology).'));
      currentOpts = () => ({
        stitchWidth: sw.get(),
        stitchHeight: sh.get(),
        amplitude: amp.get(),
        roundness: round.get(),
        grainAngleDeg: grain.get(),
        variation: variation.get(),
        seed: seed.get(),
        quality: detail.get(),
        algorithm: algo.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'cable') {
      const cw = slider('Cable width', span * 0.02, span * 0.3, span * 0.08, span * 0.005, n => n.toFixed(3), schedulePreview);
      const cp = slider('Cable pitch', span * 0.05, span * 0.6, span * 0.2, span * 0.005, n => n.toFixed(3), schedulePreview);
      const pw = slider('Ply width', span * 0.005, span * 0.1, span * 0.024, span * 0.001, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (depth)', 0, span * 0.08, span * 0.055, span * 0.001, n => n.toFixed(3), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const variation = slider('Variation', 0, 0.4, 0.08, 0.01, n => n.toFixed(2), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(cw.wrap, cp.wrap, pw.wrap, amp.wrap, grain.wrap, variation.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Rope-like cable columns with crossing ply ridges. Cable pitch controls how tightly the plies twist.'));
      currentOpts = () => ({
        cableWidth: cw.get(),
        cablePitch: cp.get(),
        plyWidth: pw.get(),
        amplitude: amp.get(),
        grainAngleDeg: grain.get(),
        variation: variation.get(),
        seed: seed.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'waffle') {
      const cw = slider('Cell width', span * 0.01, span * 0.3, span * 0.06, span * 0.005, n => n.toFixed(3), schedulePreview);
      const ch = slider('Cell height', span * 0.01, span * 0.3, span * 0.06, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (border height)', 0, span * 0.08, span * 0.05, span * 0.001, n => n.toFixed(3), schedulePreview);
      const sharp = slider('Sharpness', 1, 10, 3, 0.5, n => n.toFixed(1), schedulePreview);
      const rowOff = slider('Row offset (0=grid, 0.5=honeycomb)', 0, 1, 0, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      body.append(cw.wrap, ch.wrap, amp.wrap, sharp.wrap, rowOff.wrap, grain.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Recessed cells with raised borders. Sharpness 1=soft round, 3=crisp waffle, 8+=very thin border. Row offset 0.5 = honeycomb pattern.'));
      currentOpts = () => ({
        cellWidth: cw.get(),
        cellHeight: ch.get(),
        amplitude: amp.get(),
        sharpness: sharp.get(),
        rowOffset: rowOff.get(),
        grainAngleDeg: grain.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'fur') {
      const fs = slider('Fiber spacing', span * 0.003, span * 0.1, span * 0.02, span * 0.001, n => n.toFixed(3), schedulePreview);
      const fl = slider('Fiber length', span * 0.01, span * 0.4, span * 0.12, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (pile height)', 0, span * 0.08, span * 0.025, span * 0.001, n => n.toFixed(3), schedulePreview);
      const oct = slider('Detail (octaves)', 1, 4, 2, 1, n => String(n), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(fs.wrap, fl.wrap, amp.wrap, oct.wrap, grain.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Anisotropic noise: fine cross-grain (fiber width), coarse along-grain (fiber length). Smaller spacing = finer velvet; larger = shaggy fur.'));
      currentOpts = () => ({
        fiberSpacing: fs.get(),
        fiberLength: fl.get(),
        amplitude: amp.get(),
        octaves: oct.get(),
        grainAngleDeg: grain.get(),
        seed: seed.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'woven') {
      const ts = slider('Thread spacing', span * 0.005, span * 0.2, span * 0.04, span * 0.002, n => n.toFixed(3), schedulePreview);
      const tw = slider('Thread width (fraction)', 0.1, 0.9, 0.4, 0.05, n => n.toFixed(2), schedulePreview);
      const amp = slider('Amplitude (thread height)', 0, span * 0.06, span * 0.02, span * 0.001, n => n.toFixed(3), schedulePreview);
      const ud = slider('Under-thread depth', 0, 1, 0.5, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      body.append(ts.wrap, tw.wrap, amp.wrap, ud.wrap, grain.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Plain-weave interlacing: warp and weft threads alternate over/under. Thread width 0.4=open weave, 0.7=tight. Under-depth 0=flat valleys, 1=deep recess.'));
      currentOpts = () => ({
        threadSpacing: ts.get(),
        threadWidth: tw.get(),
        amplitude: amp.get(),
        underDepth: ud.get(),
        grainAngleDeg: grain.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'knurl') {
      const style = dropdown<'diamond' | 'straight' | 'ribs'>('Pattern', [
        ['diamond', 'Diamond (cross-hatch)'],
        ['straight', 'Straight (axial splines)'],
        ['ribs', 'Ribs (horizontal rings)'],
      ], 'diamond', schedulePreview);
      const profile = dropdown<'round' | 'pyramid'>('Profile', [
        ['round', 'Round (soft bumps)'],
        ['pyramid', 'Pyramid (straight-sided)'],
      ], 'round', schedulePreview);
      const cw = slider('Cell width (ridge spacing)', span * 0.008, span * 0.25, span * 0.05, span * 0.004, n => n.toFixed(3), schedulePreview);
      const ch = slider('Cell height', span * 0.008, span * 0.25, span * 0.05, span * 0.004, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (ridge height)', 0, span * 0.06, span * 0.02, span * 0.001, n => n.toFixed(3), schedulePreview);
      const sharp = slider('Sharpness', 1, 8, 2, 0.5, n => n.toFixed(1), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      body.append(style.wrap, profile.wrap, cw.wrap, ch.wrap, amp.wrap, sharp.wrap, grain.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Functional grip relief. Diamond = thumbscrew cross-hatch; straight = axial splines; ribs = horizontal finger rings. Profile: round = soft cosine bumps, pyramid = straight-sided machinist diamonds. Sharpness 1=soft rounded, 2=crisp, 6+=sharp peaks.'));
      currentOpts = () => ({
        style: style.get(),
        profile: profile.get(),
        cellWidth: cw.get(),
        cellHeight: ch.get(),
        amplitude: amp.get(),
        sharpness: sharp.get(),
        grainAngleDeg: grain.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'voronoi') {
      const cs = slider('Cell size', span * 0.03, span * 0.4, span * 0.12, span * 0.005, n => n.toFixed(3), schedulePreview);
      const ww = slider('Wall width (fraction)', 0.05, 0.6, 0.25, 0.01, n => n.toFixed(2), schedulePreview);
      const amp = slider('Amplitude (wall height)', 0, span * 0.08, span * 0.03, span * 0.001, n => n.toFixed(3), schedulePreview);
      const jit = slider('Irregularity (jitter)', 0, 1, 1, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      const engrave = checkbox('Engrave channels (instead of raised walls)', false, schedulePreview);
      body.append(cs.wrap, ww.wrap, amp.wrap, jit.wrap, grain.wrap, seed.wrap, engrave.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Organic cell-wall relief tracing Voronoi boundaries (cracked-mud / lampshade look). Jitter 1 = irregular cells, 0 = regular grid. Smaller wall width = thinner struts.'));
      currentOpts = () => ({
        cellSize: cs.get(),
        wallWidth: ww.get(),
        amplitude: amp.get(),
        jitter: jit.get(),
        grainAngleDeg: grain.get(),
        seed: seed.get(),
        raised: !engrave.get(),
        quality: detail.get(),
        selectedTriangles: activeSelection(),
      });
    } else if (active === 'voronoiLamp') {
      const cs = slider('Cell size', span * 0.05, span * 0.5, span * 0.16, span * 0.005, n => n.toFixed(3), schedulePreview);
      const wt = slider('Wall thickness', span * 0.01, span * 0.12, span * 0.05, span * 0.002, n => n.toFixed(3), schedulePreview);
      const sw = slider('Strut width (fraction)', 0.1, 0.6, 0.32, 0.01, n => n.toFixed(2), schedulePreview);
      const jit = slider('Irregularity (jitter)', 0, 1, 1, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      const res = sliderWithEntry('Resolution', 48, 200, 110, 1, 256, schedulePreview);
      const wtight = checkbox('One connected piece (printable)', true, schedulePreview);
      const out = dropdown<'mesh' | 'voxel'>('Output', [
        ['mesh', 'Smooth mesh (manifold-js)'],
        ['voxel', 'Voxel (paintable / .vox)'],
      ], 'mesh', schedulePreview);
      body.append(cs.wrap, wt.wrap, sw.wrap, jit.wrap, grain.wrap, seed.wrap, res.wrap, wtight.wrap, out.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'A real see-through Voronoi shell (lamp / planter): hollows the model and cuts the cell interiors clean through, leaving a strut network. Resolution auto-raises so struts stay thick enough (type a higher value than the slider for extra-crisp struts); "One connected piece" keeps just the main web (drops loose bits).'));
      body.append(el('p', 'text-[11px] text-amber-400/90', '"Smooth mesh" stays on manifold-js and meshes a continuous distance field — smooth curved walls, no voxel stair-stepping (a heavier op; allow a few seconds). "Voxel" output switches to the voxel engine — paintable and .vox-exportable, but blocky.'));
      currentOpts = () => ({
        cellSize: cs.get(),
        wallThickness: wt.get(),
        strutWidth: sw.get(),
        jitter: jit.get(),
        grainAngleDeg: grain.get(),
        seed: seed.get(),
        resolution: res.get(),
        watertight: wtight.get(),
        output: out.get(),
      });
    } else if (active === 'engrave') {
      // Text input + a small "Apply" button (and Enter) to rasterize the stamp —
      // typing no longer auto-renders on every keystroke (it was distracting).
      const textWrap = el('label', 'block mb-3 text-xs text-zinc-300');
      textWrap.append(el('div', 'mb-1', 'Text'));
      const textRow = el('div', 'flex gap-1');
      const textInput = el('input', 'flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100');
      textInput.type = 'text';
      textInput.placeholder = 'HELLO';
      textInput.value = engraveSource && engraveSource !== 'image' ? engraveSource : '';
      const textApply = el('button', 'shrink-0 px-2.5 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white', 'Apply');
      textApply.type = 'button';
      textApply.id = 'engrave-apply-text';
      // Distinct accessible name so it doesn't collide with the footer "Apply".
      textApply.setAttribute('aria-label', 'Apply text');
      textApply.title = 'Apply the text (rasterize + preview)';
      textRow.append(textInput, textApply);
      textWrap.append(textRow);

      const font = dropdown<'bold' | 'regular' | 'italic' | 'bold-italic'>('Font', [
        ['bold', 'Bold'], ['regular', 'Regular'], ['italic', 'Italic'], ['bold-italic', 'Bold italic'],
      ], 'bold', () => { if (textInput.value.trim()) rebuildEngraveMask({ text: textInput.value, font: font.get() }); });

      // Apply the typed text on demand (button or Enter) — never on each keystroke.
      const applyText = () => {
        if (textInput.value.trim()) rebuildEngraveMask({ text: textInput.value, font: font.get() });
        else { engraveMask = null; clearPreviewIfDirty(); status.textContent = 'Type text (or upload an image), then press Apply.'; }
      };
      textApply.addEventListener('click', applyText);
      textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyText(); } });

      // Image upload (UI-only path — needs local bytes; not available to the AI tool).
      const imgWrap = el('label', 'block mb-3 text-xs text-zinc-300');
      imgWrap.append(el('div', 'mb-1', '…or upload an image (dark = cut)'));
      const imgInput = el('input', 'w-full text-[11px] text-zinc-400');
      imgInput.type = 'file';
      imgInput.accept = 'image/*';
      let lastImageUrl = '';
      const invert = checkbox('Invert image (light = cut)', false, () => { if (lastImageUrl) rebuildEngraveMask({ imageUrl: lastImageUrl, invert: invert.get() }); });
      imgInput.addEventListener('change', () => {
        const file = imgInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { lastImageUrl = String(reader.result); textInput.value = ''; rebuildEngraveMask({ imageUrl: lastImageUrl, invert: invert.get() }); };
        reader.readAsDataURL(file);
      });
      imgWrap.append(imgInput);

      // Placement is always "click on the model": move the cursor over the model
      // (a live outline follows), click to drop the stamp on that face. On a flat
      // axis-aligned face the position sliders (quarter-point snaps) fine-tune it;
      // on a sloped/curved face the stamp lies flat where you clicked.
      const placeWrap = el('div', 'mb-3 p-2 rounded bg-zinc-800/40 border border-zinc-700/60');
      const placeBtn = el('button', 'w-full px-2 py-1.5 rounded text-xs bg-blue-600/80 hover:bg-blue-500 text-white mb-1', '📌 Click to place on model');
      placeBtn.type = 'button';
      placeBtn.addEventListener('click', enterEngravePick);
      const faceReadout = el('div', 'text-[11px] text-zinc-400 mb-2', `Face: ${engraveFaceLabel(engravePlace.axis, engravePlace.side)}${engravePlace.placed ? ' · placed by click' : ''}`);
      const posX = sliderWithSnaps('Position across (U)', engravePlace.posU, () => { engravePlace.posU = posX.get(); refreshEngraveOutline(); schedulePreview(); });
      const posY = sliderWithSnaps('Position up (V)', engravePlace.posV, () => { engravePlace.posV = posY.get(); refreshEngraveOutline(); schedulePreview(); });
      // Shown instead of the sliders when the stamp lies on a sloped/curved face.
      const placeNote = el('p', 'text-[11px] text-zinc-500', 'On a sloped face — position by clicking; the rotation slider still applies.');
      placeNote.style.display = 'none';
      placeWrap.append(placeBtn, faceReadout, posX.wrap, posY.wrap, placeNote);
      // Expose the live controls so the drag-to-place handler can update them.
      engravePosX = posX; engravePosY = posY; engraveFaceReadout = faceReadout; engravePlaceBtn = placeBtn;
      engravePosWraps = [posX.wrap, posY.wrap]; engravePlaceNote = placeNote;

      // In-plane rotation of the stamp on its face.
      const angle = slider('Rotation (°)', -180, 180, engravePlace.rot, 5, n => `${n}°`, () => { engravePlace.rot = angle.get(); refreshEngraveOutline(); schedulePreview(); });

      // Curvature: wrap the placed stamp around a cylinder/dome. Axis is relative
      // to the text plane (vertical → curves left↔right, like a mug/tower).
      const curveAxis = dropdown<'none' | 'v' | 'u'>('Curve (wrap around a surface)', [
        ['none', 'No curve (flat)'],
        ['v', 'Wrap around vertical axis (left↔right)'],
        ['u', 'Wrap around horizontal axis (up↔down)'],
      ], engravePlace.curveAxis, () => { engravePlace.curveAxis = curveAxis.get(); syncCurveUI(); schedulePreview(); });
      const curveAngle = slider('Wrap angle', 10, 300, engravePlace.curveAngle, 5, n => `${n}°`, () => { engravePlace.curveAngle = curveAngle.get(); schedulePreview(); });
      const syncCurveUI = () => { curveAngle.wrap.style.display = curveAxis.get() === 'none' ? 'none' : ''; };

      // Engrave (subtract) / emboss (add) / cut-through are one field math with
      // a sign flip, so they share every other control on this tab.
      const modeSel = dropdown<'engrave' | 'emboss' | 'through'>('Mode', [
        ['engrave', 'Engrave (recessed)'],
        ['emboss', 'Emboss (raised)'],
        ['through', 'Cut clean through (stencil)'],
      ], 'engrave', () => { syncEngraveModeUI(); schedulePreview(); });
      const sizeS = sliderWithEntry('Text size (width)', span * 0.1, span * 1.5, span * 0.7, span * 0.01, span * 8,
        () => { refreshEngraveOutline(); schedulePreview(); }, { round: n => Math.round(n * 1000) / 1000 });
      const depth = sliderWithEntry('Depth / raised height', span * 0.005, span * 0.3, span * 0.06, span * 0.005, span * 4,
        schedulePreview, { round: n => Math.round(n * 1000) / 1000 });
      const depthWrap = depth.wrap;
      // Optional letter color — colors the raised relief (emboss) or the
      // channel walls (engrave/through) for multicolor prints. The picker is the
      // shared filament palette (same swatches as the paint tools) + a custom
      // off-palette colour, so engrave colours stay consistent with painting.
      const colorChk = checkbox('Color the letters', false, () => { colorCtl.wrap.style.display = colorChk.get() ? '' : 'none'; schedulePreview(); });
      const colorCtl = colorField('#d4af37', schedulePreview);
      colorCtl.wrap.style.display = 'none';
      const syncEngraveModeUI = () => { depthWrap.style.display = modeSel.get() === 'through' ? 'none' : ''; };
      const res = sliderWithEntry('Resolution', 48, 220, 180, 1, 256, schedulePreview);
      const wtight = checkbox('One connected piece (printable)', true, schedulePreview);

      // Wire the live outline overlay to the current size.
      engraveSizeGet = () => sizeS.get();
      engraveIsPlanar = () => true; // placement is always face-based now → outline always applies

      body.append(textWrap, font.wrap, imgWrap, invert.wrap, placeWrap, angle.wrap, curveAxis.wrap, curveAngle.wrap, modeSel.wrap, sizeS.wrap, depthWrap, colorChk.wrap, colorCtl.wrap, res.wrap, wtight.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Stamps text or an image onto the model — engraved channels, a raised emboss, or holes cut clean through (stencil). Type text and press Apply, then "place on model": move over the model (a blue outline follows the cursor) and click to drop it on that face. Fine-tune with the position sliders / rotation, and use Curve to wrap the text around a cylinder or dome. "Color the letters" paints the stamp for multicolor prints. Raise resolution if thin strokes look mushy.'));
      syncCurveUI();
      syncEngraveModeUI();
      updateEngravePlacementUI();
      refreshEngraveOutline();

      const curveOf = () => engravePlace.curveAxis === 'none'
        ? undefined
        : { axis: engravePlace.curveAxis as 'u' | 'v', angleDeg: curveAngle.get() };
      const projOf = (): EngraveProjection => engravePlace.mode === 'free'
        ? { mode: 'free', origin: engravePlace.origin, normal: engravePlace.normal, rotationDeg: angle.get(), curve: curveOf() }
        : { mode: 'planar', axis: engravePlace.axis, side: engravePlace.side, posU: posX.get(), posV: posY.get(), rotationDeg: angle.get(), curve: curveOf() };
      currentOpts = () => ({
        mask: engraveMask,
        source: engraveSource,
        projection: projOf(),
        through: modeSel.get() === 'through',
        raised: modeSel.get() === 'emboss',
        depth: depth.get(),
        size: sizeS.get(),
        color: colorChk.get() ? colorCtl.get() : undefined,
        resolution: res.get(),
        watertight: wtight.get(),
      });
    } else if (active === 'smooth') {
      const iter = slider('Rounding strength', 1, 12, 4, 1, n => String(n), schedulePreview);
      const sub = checkbox('Subdivide first (rounds sharp corners)', true, schedulePreview);
      body.append(iter.wrap, sub.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Taubin smoothing relaxes edges into a softer form without shrinking the model. Great for low-poly or blocky parts.'));
      currentOpts = () => ({ iterations: iter.get(), subdivide: sub.get(), selectedTriangles: activeSelection() });
    } else {
      const res = slider('Resolution (voxels)', 8, 128, 32, 1, n => String(n), schedulePreview);
      const sm = checkbox('Smooth voxels (rounded corners)', false, schedulePreview);
      body.append(res.wrap, sm.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Rasterizes the model into voxels. The result switches to the voxel engine, so you can paint, re-block, or .vox export it.'));
      currentOpts = () => ({ resolution: res.get(), smooth: sm.get() });
    }
    // Refresh Apply/Preview state — switching to a region-less tab must clear
    // the "pick a region first" block, and the Apply label + path hint depend
    // on the active tab.
    updateApplyBtn();
    schedulePreview();
  }

  // --- Live preview (debounced) ---
  let previewTimer: number | undefined;
  let previewDirty = false; // a preview is currently shown (needs clearing on close)
  async function runPreview() {
    // If the model's in-code textures are parked (the user cancelled a compute
    // — the "Re-apply" pill state), apply them first so the preview shows the
    // modifier ON TOP of the textured model, not on the untextured base.
    try { await api.ensureSurfaceTexturesApplied(); } catch { /* preview on whatever is live */ }
    // SDF carves (engrave / voronoi lamp) are async + show the progress modal;
    // the rest resolve immediately. Either way we await the result.
    // In apply-as-code mode, fold in the label/point scope (empty otherwise) so a
    // scoped preview shows the same patch Apply will write — not the whole model.
    const r = await api.previewSurfaceModifier(active, { ...currentOpts(), ...scopeOpts() }, preserveColor);
    if ((r as { error?: string }).error) {
      status.textContent = `Preview error: ${(r as { error: string }).error}`;
    } else {
      previewDirty = true;
      status.textContent = 'Previewing — Apply to save a version.';
      // updateMesh clears meshGroup children — re-draw the selection overlay on top
      reapplySelectionOverlay();
    }
  }
  function schedulePreview() {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    // Region mode with nothing selected: don't fire a preview at all
    if (regionBlocked()) {
      clearPreviewIfDirty();
      updateRegionStatus(); // ensures the blue-400 nudge text is shown
      return;
    }
    // Engrave needs a rasterized stamp before any preview makes sense.
    if (active === 'engrave' && !engraveMask) {
      clearPreviewIfDirty();
      status.textContent = engraveBuilding ? 'Rasterizing stamp…' : 'Type text and press Apply (or upload an image) to engrave.';
      return;
    }
    status.textContent = 'Updating preview…';
    previewTimer = window.setTimeout(runPreview, getConfig().ui.surfacePreviewDebounceMs);
  }

  // Rebuild the engrave ink mask from the text/image inputs, then preview. Async
  // (font fetch / image decode); reused for every preview/apply until inputs change.
  async function rebuildEngraveMask(spec: { text?: string; font?: 'regular' | 'bold' | 'italic' | 'bold-italic'; imageUrl?: string; invert?: boolean }) {
    engraveBuilding = true;
    engraveMask = null;
    status.textContent = 'Rasterizing stamp…';
    try {
      const r = await api.buildEngraveStamp(spec);
      if ('error' in r) { status.textContent = `Stamp error: ${r.error}`; return; }
      engraveMask = r.mask;
      engraveSource = spec.text ? spec.text : 'image';
    } catch (e) {
      status.textContent = `Stamp error: ${e instanceof Error ? e.message : String(e)}`;
      return;
    } finally {
      engraveBuilding = false;
    }
    if (active === 'engrave') { refreshEngraveOutline(); schedulePreview(); }
  }

  // --- Drag-to-place: a live footprint outline follows the cursor over the
  // model (like the paint brush cursor); clicking drops the engraving there. ---

  /** Map a surface hit → a placement. A near-axis normal snaps to an axis-aligned
   *  face (sliders + snaps apply); a sloped/curved face lies flat where clicked. */
  function placementFromHit(point: Vec3, normal: Vec3): EngravePlacement {
    const an = normal.map(Math.abs) as Vec3;
    const ax = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2;
    // Within ~18° of an axis → treat as a flat axis-aligned face.
    if (an[ax] >= 0.95) {
      const bb = modelBBox(api);
      const axis = (['x', 'y', 'z'] as const)[ax];
      const [ui, vi] = ENGRAVE_PLANE_AXES[axis];
      const frac = (i: number) => (bb.size[i] > 1e-9 ? Math.min(1, Math.max(0, (point[i] - bb.min[i]) / bb.size[i])) : 0.5);
      return { mode: 'planar', axis, side: normal[ax] >= 0 ? 'max' : 'min', posU: frac(ui), posV: frac(vi), rot: engravePlace.rot };
    }
    return { mode: 'free', origin: point, normal, rot: engravePlace.rot };
  }

  /** Draw the footprint outline for a placement (defaults to the committed one).
   *  Hidden for cylindrical mode (no flat footprint) or when there's no stamp. */
  function refreshEngraveOutline(place: EngravePlacement = currentPlacement()) {
    if (active !== 'engrave' || !engraveMask || !engraveSizeGet || !(engraveIsPlanar?.() ?? false)) {
      hideEngraveOutline();
      return;
    }
    const aspect = engraveMask.width / Math.max(1, engraveMask.height);
    const size = engraveSizeGet();
    const bb = modelBBox(api);
    const span = Math.max(bb.size[0], bb.size[1], bb.size[2]);
    if (place.mode === 'free') {
      showEngraveOutline(engraveFreeFootprint(place.origin, place.normal, { size, aspect, rotationDeg: place.rot, lift: Math.max(span * 0.003, 0.05) }));
    } else {
      const axisIdx = place.axis === 'x' ? 0 : place.axis === 'y' ? 1 : 2;
      showEngraveOutline(engravePlanarFootprint(
        { min: bb.min as Vec3, max: bb.max as Vec3, size: bb.size as Vec3 },
        { axis: place.axis, side: place.side, posU: place.posU, posV: place.posV, rotationDeg: place.rot, size, aspect, lift: Math.max(bb.size[axisIdx] * 0.003, 0.05) },
      ));
    }
  }

  /** Show/hide the position sliders + face readout for the current placement
   *  mode — sliders only apply to a flat axis-aligned face. */
  function updateEngravePlacementUI() {
    const free = engravePlace.mode === 'free';
    for (const w of engravePosWraps) w.style.display = free ? 'none' : '';
    if (engravePlaceNote) engravePlaceNote.style.display = free ? '' : 'none';
    if (engraveFaceReadout) {
      engraveFaceReadout.textContent = free
        ? 'Sloped/curved face · placed by click'
        : `Face: ${engraveFaceLabel(engravePlace.axis, engravePlace.side)}${engravePlace.placed ? ' · placed by click' : ''}`;
    }
  }

  /** Commit a placement to the state + sliders, then re-preview the engraving. */
  function commitPlacement(place: EngravePlacement) {
    engravePlace.mode = place.mode;
    engravePlace.rot = place.rot;
    if (place.mode === 'planar') {
      engravePlace.axis = place.axis; engravePlace.side = place.side;
      engravePlace.posU = place.posU; engravePlace.posV = place.posV;
      engravePosX?.set(place.posU); engravePosY?.set(place.posV);
    } else {
      engravePlace.origin = place.origin; engravePlace.normal = place.normal;
    }
    engravePlace.placed = true;
    updateEngravePlacementUI();
    refreshEngraveOutline();
    schedulePreview();
  }

  function exitEngravePick() {
    if (engravePointerMove) { getCanvas().removeEventListener('pointermove', engravePointerMove); engravePointerMove = null; }
    if (engravePickStop) { engravePickStop(); engravePickStop = null; }
    document.body.style.cursor = '';
    if (engravePlaceBtn) engravePlaceBtn.textContent = '📌 Click to place on model';
    refreshEngraveOutline(); // snap the outline back to the committed placement
  }
  function enterEngravePick() {
    if (engravePickStop) { exitEngravePick(); return; }
    document.body.style.cursor = 'crosshair';
    status.textContent = 'Move over the model — the outline follows; click to place.';
    if (engravePlaceBtn) engravePlaceBtn.textContent = '◉ Placing… (click to stop)';
    // Hover: project the cursor onto the surface and float the outline there.
    engravePointerMove = (evt: PointerEvent) => {
      if (!getCurrentMesh()) return;
      const hit = pickFace(evt as unknown as MouseEvent);
      if (!hit) return; // keep the last outline when off the model
      refreshEngraveOutline(placementFromHit(hit.point, hit.normal));
    };
    getCanvas().addEventListener('pointermove', engravePointerMove);
    // Click: suppress orbit, drop the engraving at the hit point, and exit place
    // mode (the button toggles back, so it never looks frozen during the render).
    engravePickStop = addPointerSuppressor((evt: PointerEvent) => {
      if (evt.type !== 'pointerdown') return false;
      if (!getCurrentMesh()) return true;
      const hit = pickFace(evt as MouseEvent);
      if (!hit) return true; // empty space — keep placing
      const place = placementFromHit(hit.point, hit.normal);
      exitEngravePick();
      commitPlacement(place);
      return true;
    });
  }

  function clearPreviewIfDirty() {
    if (previewTimer !== undefined) { clearTimeout(previewTimer); previewTimer = undefined; }
    if (previewDirty) {
      api.clearSurfacePreview();
      previewDirty = false;
      // clearSurfacePreview calls updateMesh — re-draw the overlay so it persists
      reapplySelectionOverlay();
    }
  }

  const tabBtns = new Map<Tab, HTMLButtonElement>();
  function styleTabs() {
    for (const [id, b] of tabBtns) {
      b.className = id === active
        ? 'px-2.5 py-1 rounded text-xs bg-blue-600 text-white'
        : 'px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
    }
  }
  for (const t of tabs) {
    const b = el('button', '', t.label);
    b.addEventListener('click', () => { active = t.id; styleTabs(); renderTab(); });
    tabBtns.set(t.id, b);
    tabRow.append(b);
  }

  scrollBody.append(regionSection, codeScopeSection, tabRow, body);
  if (painted) scrollBody.append(colorRow);
  scrollBody.append(status);

  // Which path Apply takes for the current tab/mode/session — kept current by
  // updateApplyBtn so the bake-vs-code distinction is visible before clicking.
  const pathHint = el('div', 'text-[11px] text-zinc-500 mb-2');
  scrollBody.append(pathHint);

  // Footer: Cancel | Preview | Apply.
  const footer = el('div', 'flex justify-end gap-2 mt-2');
  const cancelBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs', 'Cancel');
  const previewBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs', 'Preview');
  const applyBtn = el('button', 'px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium', 'Apply');
  footer.append(cancelBtn, previewBtn, applyBtn);
  scrollBody.append(footer);

  const close = () => {
    exitSelectionMode();
    stopScopePick();
    exitEngravePick();
    disposeEngraveOutline();
    regionTeardown?.(); regionTeardown = null;
    clearPreviewIfDirty();
    dragHandle.destroy();
    panel.remove();
    openModal = null;
    currentSurfaceClose = null;
    closeViewportPanel(surfaceRegistryEntry);
    document.removeEventListener('keydown', onSurfaceEscape);
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  previewBtn.addEventListener('click', () => {
    if (regionBlocked()) return;
    runPreview();
  });

  applyBtn.addEventListener('click', async () => {
    if (active === 'engrave' && !engraveMask) {
      status.textContent = 'Type text (or upload an image) to engrave first.';
      return;
    }
    // The preview swapped the displayed mesh; clear it so the apply re-runs from
    // the real current model (commit re-renders the saved result anyway).
    clearPreviewIfDirty();
    applyBtn.disabled = true;
    const prev = applyBtn.textContent;
    applyBtn.textContent = 'Applying…';
    status.textContent = 'Working…';
    try {
      const opts = { ...currentOpts(), preserveColor };
      // In-code path (manifold-js, whole model, in-code-able modifier): write an
      // api.surface.* call instead of baking. selectedTriangles is always
      // undefined here (whole-model mode) and preserveColor doesn't apply —
      // paint re-resolves against the textured mesh on every run.
      const asCodeOpts = (): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(currentOpts())) {
          if (k === 'selectedTriangles' || v === undefined) continue;
          if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
        }
        return { ...out, ...scopeOpts() }; // add label/region scope (empty unless scoped)
      };
      const result = applyWritesCode() ? await api.applySurfaceTextureAsCode(active, asCodeOpts())
        : active === 'fuzzy' ? await api.applyFuzzySkin(opts)
        : active === 'knit' ? await api.applyKnitTexture(opts)
        : active === 'cable' ? await api.applyCableKnit(opts)
        : active === 'waffle' ? await api.applyWaffleStitch(opts)
        : active === 'fur' ? await api.applyFurVelvet(opts)
        : active === 'woven' ? await api.applyWovenFabric(opts)
        : active === 'knurl' ? await api.applyKnurlTexture(opts)
        : active === 'voronoi' ? await api.applyVoronoiShell(opts)
        : active === 'voronoiLamp' ? await api.applyVoronoiLamp(opts)
        : active === 'engrave' ? await api.engraveModel(opts)
        : active === 'smooth' ? await api.smoothModel(opts)
        : await api.voxelizeModel(opts);
      const err = (result as { error?: string })?.error;
      if (err) {
        status.textContent = `Error: ${err}`;
        applyBtn.disabled = false;
        applyBtn.textContent = prev;
        return;
      }
      close();
    } catch (e) {
      status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      applyBtn.disabled = false;
      applyBtn.textContent = prev;
    }
  });

  styleTabs();
  renderTab(); // kicks off the first preview

  container.append(panel);
  setInitialPanelPosition(panel);
  currentSurfaceClose = close;
  openViewportPanel(surfaceRegistryEntry);
  document.addEventListener('keydown', onSurfaceEscape);
  openModal = panel;
}

/** Wire the surface modifiers into the viewport overlay and command palette. */
export function initSurfaceUI(api: SurfaceApi): void {
  // Command palette entries — one per modifier, opening the modal on that tab.
  registerCommands([
    { id: 'surface-fuzzy', title: 'Surface: Fuzzy skin', hint: 'Modifier', keywords: 'texture displacement rough print fuzzy', run: () => openSurfaceModal(api, 'fuzzy') },
    { id: 'surface-knit', title: 'Surface: Knit texture', hint: 'Modifier', keywords: 'knit stitch fabric texture sweater yarn stockinette', run: () => openSurfaceModal(api, 'knit') },
    { id: 'surface-cable', title: 'Surface: Cable knit', hint: 'Modifier', keywords: 'cable knit aran rope twist ply yarn sweater', run: () => openSurfaceModal(api, 'cable') },
    { id: 'surface-waffle', title: 'Surface: Waffle stitch', hint: 'Modifier', keywords: 'waffle stitch grid honeycomb cell recessed border', run: () => openSurfaceModal(api, 'waffle') },
    { id: 'surface-fur', title: 'Surface: Fur / velvet', hint: 'Modifier', keywords: 'fur velvet pile fabric soft directional fiber', run: () => openSurfaceModal(api, 'fur') },
    { id: 'surface-woven', title: 'Surface: Woven fabric', hint: 'Modifier', keywords: 'woven weave fabric basket cloth interlace thread', run: () => openSurfaceModal(api, 'woven') },
    { id: 'surface-knurl', title: 'Surface: Knurl grip', hint: 'Modifier', keywords: 'knurl knurling grip diamond cross-hatch straight splines ribs knob thumbscrew handle texture', run: () => openSurfaceModal(api, 'knurl') },
    { id: 'surface-voronoi', title: 'Surface: Voronoi texture', hint: 'Modifier', keywords: 'voronoi cell relief organic cracked web ridges struts texture', run: () => openSurfaceModal(api, 'voronoi') },
    { id: 'surface-voronoi-lamp', title: 'Surface: Voronoi lamp (perforated shell)', hint: 'Modifier', keywords: 'voronoi lamp shell lattice perforated cutout holes see-through planter lampshade voxel', run: () => openSurfaceModal(api, 'voronoiLamp') },
    { id: 'surface-engrave', title: 'Surface: Engrave / emboss / cut-through text or image', hint: 'Modifier', keywords: 'engrave emboss carve raised relief cut through text image stencil label logo name plate recess channel color', run: () => openSurfaceModal(api, 'engrave') },
    { id: 'surface-smooth', title: 'Surface: Smooth / round edges', hint: 'Modifier', keywords: 'smooth round fillet taubin low-poly', run: () => openSurfaceModal(api, 'smooth') },
    { id: 'surface-voxelize', title: 'Surface: Voxelize model', hint: 'Modifier', keywords: 'voxel blocky minecraft pixel', run: () => openSurfaceModal(api, 'voxelize') },
  ]);

  // Viewport overlay button — inserted next to the Relief/Paint controls without
  // touching the overlay's creation code. Match the neighbour's styling.
  const mount = () => {
    if (document.getElementById('surface-viewport-toggle')) return;
    // Land inside the Tools popover; borrow the paint button's styling so the
    // pill matches its neighbours. Falls back to the paint button's parent for
    // any non-grouped layout.
    const styleRef = document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
    btn.id = 'surface-viewport-toggle';
    btn.textContent = '✦ Surface';
    btn.title = 'Apply fuzzy skin, smooth/round, or voxelize the current model';
    btn.addEventListener('click', () => openSurfaceModal(api));
    host.appendChild(btn);
  };
  // The overlay may mount after init; retry a few times then give up (commands
  // still work even if the button never lands).
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('surface-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
