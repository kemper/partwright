// Wizard modal that turns an imported image into a printable colour tile,
// keychain, or stepped relief. The user picks an image, chooses a mapping
// mode, tunes the knobs, watches a live grayscale/colored preview, and clicks
// Create. Mesh generation itself is the host's job — this modal only resolves
// options and hands back the source ImageData via onCreate.

import type { ReliefOptions, ReliefImportMode, TileOutputKind, TileShapeKind, HeightGrid, ReliefMesh, SeedRegion } from '../relief/types';
import { DEFAULT_RELIEF_OPTIONS } from '../relief/types';
import { sampleImageToGrid, detectBackgroundMask, bgMaskFromColor, generateRelief, generateReliefFromSvg } from '../relief/imageToRelief';
import { registerImport, type ImportMetadata } from '../import/importInbox';
import { createThumbnailFromBlob } from '../import/imageThumbnail';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import * as THREE from 'three';

export interface ReliefImportModalOptions {
  aiAvailable: boolean;
  // Pre-load this file as if the user picked it (used by Recent Imports
  // re-clicks so the wizard reopens with the previous source).
  initialFile?: File;
  // Pre-load these option values (recent imports keep the user's tweaks so
  // a re-click reopens the wizard already tuned).
  initialOptions?: ReliefOptions;
  // Called when the user clicks "AI assist"; returns option overrides to merge.
  onAiAssist?: (image: ImageData, opts: ReliefOptions) => Promise<Partial<ReliefOptions> & { note?: string }>;
  // Called on Create with the chosen image + resolved options + a base name.
  onCreate: (image: ImageData, opts: ReliefOptions, sourceName: string) => void | Promise<void>;
  // Called on Create when the chosen file is an SVG — the host parses it and
  // builds a multi-colour tile directly from the per-fill paths.
  onCreateSvg?: (svgText: string, opts: ReliefOptions, sourceName: string) => void | Promise<void>;
}

const PREVIEW_PX = 220;
const DEBOUNCE_MS = 120;
const MAX_RESOLUTION = 512;
// 3D preview rebuilds use a downscaled grid — mesh generation is fast at this
// size and the wizard's static thumbnail doesn't benefit from print-quality
// fidelity. Quality previews happen in the studio after Create.
const PREVIEW_3D_RESOLUTION = 64;
const PREVIEW_3D_DEBOUNCE_MS = 250;

interface ModeDef {
  id: ReliefImportMode;
  label: string;
}

const MODES: ModeDef[] = [
  // Order matches the new default: colour-region tiles (the keychain workflow)
  // first, tonal heightmaps (lithophanes) second. 'ai' is intentionally absent
  // — what used to live as a tab is now the Auto-tune button below the knobs,
  // since it never had its own knob set and read as a phantom mode.
  { id: 'quantized', label: 'Colour' },
  { id: 'luminance', label: 'Tonal (relief)' },
];

// Only one relief wizard at a time; createModalShell already enforces a single
// shell, but we keep our own flag to short-circuit re-entrant opens cleanly.
let isOpen = false;

export function openReliefImportModal(options: ReliefImportModalOptions): void {
  if (isOpen) return;
  isOpen = true;

  const opts: ReliefOptions = structuredClone(DEFAULT_RELIEF_OPTIONS);
  // Recent-imports re-clicks pass back the previously-used options so the user
  // re-enters the wizard with their tweaks intact. Merge (not replace) so any
  // new option fields added since that import still get their defaults.
  if (options.initialOptions) mergeOptions(opts, options.initialOptions);
  let image: ImageData | null = null;
  let svgText: string | null = null;
  // The currently-picked source File, captured so we can register it with the
  // recent-imports inbox after a successful Create, and re-open from there.
  let pickedFile: File | null = null;
  let baseName = 'relief';
  let creating = false;
  let previewTimer: number | undefined;

  // Registered by each knob factory below. Declared up here because the
  // factories run during construction (when the knob controls are created) and
  // would otherwise reference this const in its temporal dead zone, throwing
  // mid-build and leaving the modal without its change handler / Create button.
  const controlRefreshers: Array<() => void> = [];
  function refreshControls(): void {
    for (const fn of controlRefreshers) fn();
  }

  const shell = createModalShell({
    title: 'Make a part from an image',
    maxWidth: '2xl',
    scrollable: true,
    onClose: () => {
      if (previewTimer !== undefined) window.clearTimeout(previewTimer);
      if (preview3DTimer !== undefined) window.clearTimeout(preview3DTimer);
      three.dispose();
      isOpen = false;
    },
  });

  // --- Source picker -------------------------------------------------------
  const pickRow = document.createElement('div');
  pickRow.className = 'flex items-center gap-3';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,.svg,image/svg+xml';
  fileInput.className = 'hidden';

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-700 text-zinc-100 hover:bg-zinc-600 transition-colors';
  pickBtn.textContent = 'Choose image…';
  pickBtn.addEventListener('click', () => fileInput.click());

  const thumb = document.createElement('img');
  thumb.className = 'w-12 h-12 rounded border border-zinc-700 object-cover hidden bg-zinc-900';

  const sourceLabel = document.createElement('span');
  sourceLabel.className = 'text-[11px] text-zinc-400 truncate flex-1 min-w-0';
  sourceLabel.textContent = 'No image selected';

  // Background-pick indicator: swatch + clear button, shown when the user has
  // clicked a colour on the thumbnail (silhouette mode).
  const bgPickWrap = document.createElement('div');
  bgPickWrap.className = 'hidden flex items-center gap-1';
  const bgPickSwatch = document.createElement('span');
  bgPickSwatch.className = 'w-4 h-4 rounded border border-zinc-600';
  bgPickSwatch.title = 'Manual background colour';
  const bgPickClear = document.createElement('button');
  bgPickClear.type = 'button';
  bgPickClear.className = 'text-[10px] text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline';
  bgPickClear.textContent = 'clear';
  bgPickClear.title = 'Revert to auto background detection';
  bgPickClear.addEventListener('click', () => {
    opts.quantized.manualBackground = undefined;
    syncMode();
    renderPreview();
  });
  bgPickWrap.append(bgPickSwatch, bgPickClear);

  pickRow.append(fileInput, pickBtn, thumb, sourceLabel, bgPickWrap);
  shell.body.appendChild(pickRow);

  // --- Mode selector -------------------------------------------------------
  const modeRow = document.createElement('div');
  modeRow.className = 'flex rounded-lg overflow-hidden border border-zinc-700';
  const modeButtons = new Map<ReliefImportMode, HTMLButtonElement>();

  for (const def of MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flex-1 px-3 py-1.5 text-xs font-medium transition-colors';
    btn.textContent = def.label;
    const enabled = def.id !== 'ai' || options.aiAvailable;
    if (!enabled) {
      btn.disabled = true;
      btn.classList.add('opacity-40', 'cursor-not-allowed');
      btn.title = 'Connect an AI provider to enable';
    } else {
      btn.addEventListener('click', () => {
        opts.mode = def.id;
        syncMode();
        schedulePreview();
      });
    }
    modeButtons.set(def.id, btn);
    modeRow.appendChild(btn);
  }
  shell.body.appendChild(modeRow);

  // --- AI assist note caption ---------------------------------------------
  const aiNote = document.createElement('p');
  aiNote.className = 'text-[11px] text-indigo-300 leading-snug hidden';

  // --- Knob sections -------------------------------------------------------
  const knobs = document.createElement('div');
  knobs.className = 'flex flex-col gap-4';

  // --- Image pre-processing knobs (applied before clustering / luminance) ---
  const imageSection = makeSection('Image');
  sliderControl(imageSection.grid, 'Brightness', '', () => opts.preprocess.brightness, v => (opts.preprocess.brightness = v), { min: -1, max: 1, step: 0.05 });
  sliderControl(imageSection.grid, 'Contrast', '', () => opts.preprocess.contrast, v => (opts.preprocess.contrast = v), { min: -1, max: 1, step: 0.05 });
  sliderControl(imageSection.grid, 'Saturation', '', () => opts.preprocess.saturation, v => (opts.preprocess.saturation = v), { min: -1, max: 1, step: 0.05 });
  sliderControl(imageSection.grid, 'Black point', '', () => opts.preprocess.levelsLow, v => (opts.preprocess.levelsLow = v), { min: 0, max: 254, step: 1, int: true });
  sliderControl(imageSection.grid, 'White point', '', () => opts.preprocess.levelsHigh, v => (opts.preprocess.levelsHigh = v), { min: 1, max: 255, step: 1, int: true });

  const commonSection = makeSection('Geometry');
  const luminanceSection = makeSection('Luminance mapping');
  const quantizedSection = makeSection('Colour regions');

  // Common knobs — always visible.
  numberControl(commonSection.grid, 'Width', 'mm', () => opts.common.widthMm, v => (opts.common.widthMm = v), { min: 1, max: 1000, step: 1 });
  numberControl(commonSection.grid, 'Layer height', 'mm', () => opts.common.layerHeight, v => (opts.common.layerHeight = v), { min: 0.02, max: 1, step: 0.01 });
  numberControl(commonSection.grid, 'Base thickness', 'mm', () => opts.common.baseThickness, v => (opts.common.baseThickness = v), { min: 0, max: 20, step: 0.1 });
  numberControl(commonSection.grid, 'Max height', 'mm', () => opts.common.maxHeight, v => (opts.common.maxHeight = v), { min: 0.1, max: 50, step: 0.1 });
  sliderControl(commonSection.grid, 'Resolution', 'cols', () => opts.common.resolution, v => (opts.common.resolution = v), { min: 8, max: MAX_RESOLUTION, step: 1, int: true });
  sliderControl(commonSection.grid, 'Smoothing', 'px', () => opts.common.smoothing, v => (opts.common.smoothing = v), { min: 0, max: 10, step: 1, int: true });

  // Luminance knobs — luminance + ai modes.
  checkboxControl(luminanceSection.grid, 'Invert (bright = short)', () => opts.luminance.invert, v => (opts.luminance.invert = v));
  sliderControl(luminanceSection.grid, 'Gamma', '', () => opts.luminance.gamma, v => (opts.luminance.gamma = v), { min: 0.2, max: 3, step: 0.05 });
  sliderControl(luminanceSection.grid, 'Levels', '', () => opts.luminance.levels, v => (opts.luminance.levels = v), { min: 2, max: 32, step: 1, int: true });

  // Quantized knobs — quantized mode only.
  sliderControl(quantizedSection.grid, 'Clusters', '', () => opts.quantized.clusters, v => (opts.quantized.clusters = v), { min: 2, max: 12, step: 1, int: true });
  selectControl(quantizedSection.grid, 'Color space', () => opts.quantized.colorSpace, v => (opts.quantized.colorSpace = v), [
    { value: 'rgb', label: 'RGB' },
    { value: 'lab', label: 'Lab' },
  ]);
  checkboxControl(quantizedSection.grid, 'Dither', () => opts.quantized.dither, v => (opts.quantized.dither = v));

  // Tile knobs — visible for 'quantized' mode and for SVG imports. The Output
  // picker switches between a stepped relief, a flat colour tile (keychain
  // style), and a tile cut to the image's subject silhouette.
  const tileSection = makeSection('Tile output');
  const outputRow = selectControl<TileOutputKind>(tileSection.grid, 'Output', () => opts.quantized.output, v => { opts.quantized.output = v; syncMode(); }, [
    { value: 'flat', label: 'Flat tile (keychain)' },
    { value: 'silhouette', label: 'Cut to subject' },
    { value: 'relief', label: 'Stepped relief' },
  ]);
  // SVG imports skip the height grid (each path fill becomes one region on a
  // flat tile), so 'relief' is meaningless — `generateReliefFromSvg` would
  // silently fall through to the rect/rounded/circle ternary and emit a flat
  // tile anyway. Hide the option for SVGs so the dropdown doesn't promise
  // something the pipeline can't deliver.
  const outputReliefOption = outputRow.querySelector('select option[value="relief"]') as HTMLOptionElement | null;
  selectControl<TileShapeKind>(tileSection.grid, 'Shape', () => opts.quantized.shape, v => (opts.quantized.shape = v), [
    { value: 'rect', label: 'Rectangle' },
    { value: 'rounded', label: 'Rounded' },
    { value: 'circle', label: 'Circle' },
  ]);
  sliderControl(tileSection.grid, 'Corner radius', 'mm', () => opts.quantized.cornerRadiusMm, v => (opts.quantized.cornerRadiusMm = v), { min: 0, max: 20, step: 0.5 });
  sliderControl(tileSection.grid, 'Top-edge chamfer', 'mm', () => opts.quantized.chamferMm, v => (opts.quantized.chamferMm = v), { min: 0, max: 2, step: 0.05 });
  // Stepped-relief painting mode — single-nozzle (Z-banded, slicer-faithful)
  // vs multi-color (per-cluster, AMS-friendly). Hidden when output != 'relief'.
  const paintingModeRow = selectControl<'single-nozzle' | 'multi-color'>(tileSection.grid, 'Painting mode', () => opts.quantized.paintingMode, v => (opts.quantized.paintingMode = v), [
    { value: 'single-nozzle', label: 'Single-nozzle (Z-banded)' },
    { value: 'multi-color', label: 'Multi-colour (AMS)' },
  ]);
  // "Invert heights" — flips the cluster→height map so DARKER colours are
  // TALLER. For figure-on-light-background images (the common case), the
  // default (bright = tall) makes the background occlude the figure from a
  // top-down view; turning this on raises the subject instead.
  const invertHeightsRow = checkboxControl(tileSection.grid, 'Invert (dark = tall)', () => opts.quantized.invertHeights, v => (opts.quantized.invertHeights = v));
  // Inline hint: single-nozzle prints need one Z-band per cluster. If
  // maxHeight < (clusters - 1) × layerHeight, two clusters land in the same
  // band and the slicer has to swap mid-layer. Surface the required
  // minimum so the user can fix it without having to read the error after
  // hitting Create.
  const layerFitHint = document.createElement('div');
  layerFitHint.className = 'hidden col-span-2 text-[10px] leading-snug px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200';
  tileSection.grid.appendChild(layerFitHint);

  // Holes editor — one row per hole with diameter + position inputs. Click
  // the preview canvas to drop a new hole at that point; "+ Add hole" drops
  // one centred near the top edge.
  const holesSection = document.createElement('div');
  holesSection.className = 'flex flex-col gap-2';
  const holesHeading = document.createElement('div');
  holesHeading.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500';
  holesHeading.textContent = 'Holes';
  const holesList = document.createElement('div');
  holesList.className = 'flex flex-col gap-1.5';
  const holesActionsRow = document.createElement('div');
  holesActionsRow.className = 'flex items-center justify-between gap-2 pt-1';
  const holesHint = document.createElement('span');
  holesHint.className = 'text-[10px] text-zinc-500';
  holesHint.textContent = 'Tip: click the preview to drop a hole.';
  const addHoleBtn = document.createElement('button');
  addHoleBtn.type = 'button';
  addHoleBtn.className = 'px-2 py-1 rounded text-[11px] bg-zinc-700/60 hover:bg-zinc-600/60 text-zinc-200 transition-colors';
  addHoleBtn.textContent = '+ Add hole';
  addHoleBtn.addEventListener('click', () => {
    const widthMm = opts.common.widthMm;
    const heightMm = widthMm; // best-effort default Y until preview-click adjusts it
    opts.quantized.holes = [...opts.quantized.holes, { cxMm: 0, cyMm: heightMm / 2 - 6, diameterMm: 6 }];
    renderHoles();
    schedulePreview();
  });
  holesActionsRow.append(holesHint, addHoleBtn);
  holesSection.append(holesHeading, holesList, holesActionsRow);

  function renderHoles(): void {
    holesList.replaceChildren();
    if (opts.quantized.holes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-[11px] text-zinc-500';
      empty.textContent = 'No holes — the tile is solid. Click the preview, or "+ Add hole".';
      holesList.appendChild(empty);
      return;
    }
    opts.quantized.holes.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5';
      const label = document.createElement('span');
      label.className = 'text-[10px] text-zinc-500 w-6 shrink-0 font-mono';
      label.textContent = `#${i + 1}`;
      row.appendChild(label);
      const mk = (get: () => number, set: (v: number) => void): HTMLInputElement => {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.5';
        input.value = get().toFixed(1);
        input.className = 'w-14 px-1.5 py-1 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v)) { set(v); schedulePreview(); }
        });
        return input;
      };
      const dia = mk(() => h.diameterMm, v => (h.diameterMm = Math.max(0.5, v)));
      dia.title = 'Diameter (mm)';
      const cx = mk(() => h.cxMm, v => (h.cxMm = v));
      cx.title = 'X centre (mm, 0 = middle)';
      const cy = mk(() => h.cyMm, v => (h.cyMm = v));
      cy.title = 'Y centre (mm, +Y = top)';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 text-base leading-none';
      rm.textContent = '×';
      rm.title = 'Remove this hole';
      rm.addEventListener('click', () => {
        opts.quantized.holes = opts.quantized.holes.filter((_, idx) => idx !== i);
        renderHoles();
        schedulePreview();
      });
      const dLabel = document.createElement('span');
      dLabel.className = 'text-[10px] text-zinc-500';
      dLabel.textContent = 'Ø';
      const xLabel = document.createElement('span');
      xLabel.className = 'text-[10px] text-zinc-500 ml-1';
      xLabel.textContent = 'x';
      const yLabel = document.createElement('span');
      yLabel.className = 'text-[10px] text-zinc-500 ml-1';
      yLabel.textContent = 'y';
      row.append(dLabel, dia, xLabel, cx, yLabel, cy, rm);
      holesList.appendChild(row);
    });
  }
  renderHoles();
  controlRefreshers.push(renderHoles);

  knobs.append(imageSection.root, commonSection.root, luminanceSection.root, quantizedSection.root, tileSection.root, holesSection);

  // Two-column shell on md+ so the preview stays visible while the user
  // scrolls the knobs. On mobile the columns stack — same flow as before.
  const gridWrap = document.createElement('div');
  gridWrap.className = 'flex flex-col md:grid md:grid-cols-[1fr_minmax(0,260px)] md:gap-5 md:items-start';

  const gridLeft = document.createElement('div');
  gridLeft.className = 'flex flex-col gap-3 min-w-0';
  gridLeft.append(aiNote, knobs);

  const gridRight = document.createElement('div');
  // Sticky top so the preview hovers in view while the user scrolls the knob
  // column — falls back to a static block on mobile (no md: prefix).
  gridRight.className = 'flex flex-col gap-2 md:sticky md:top-0';

  gridWrap.append(gridLeft, gridRight);
  shell.body.appendChild(gridWrap);

  // --- Crop editor (in the right column, above the previews) --------------
  // Drag the rectangle to move, drag handles to resize. When shape is
  // 'circle', the crop aspect locks to 1:1 so the inscribed circle fills the
  // crop. Crop is stored on opts.crop as normalised 0..1 box.
  const cropEditor = document.createElement('div');
  cropEditor.className = 'hidden flex flex-col items-center gap-1';
  const cropHeading = document.createElement('div');
  cropHeading.className = 'text-[10px] text-zinc-500 font-mono self-start';
  cropHeading.textContent = 'Crop · drag corners to resize';
  const cropContainer = document.createElement('div');
  cropContainer.className = 'relative select-none touch-none rounded border border-zinc-700 overflow-hidden bg-zinc-900';
  cropContainer.style.maxWidth = '200px';
  cropContainer.style.width = '200px';
  const cropImg = document.createElement('img');
  cropImg.className = 'block w-full h-auto pointer-events-none';
  cropImg.draggable = false;
  cropContainer.appendChild(cropImg);
  // 4 dim panels around the crop rectangle. Each absolutely-positioned to
  // shade the part of the image that's being cropped away.
  const dimTop = document.createElement('div');
  const dimRight = document.createElement('div');
  const dimBottom = document.createElement('div');
  const dimLeft = document.createElement('div');
  for (const d of [dimTop, dimRight, dimBottom, dimLeft]) {
    d.className = 'absolute bg-black/55 pointer-events-none';
    cropContainer.appendChild(d);
  }
  const cropRect = document.createElement('div');
  cropRect.className = 'absolute border-2 border-white/90 cursor-move shadow-[0_0_0_1px_rgba(0,0,0,0.4)]';
  cropContainer.appendChild(cropRect);
  // 8 handles: 4 corners + 4 edges. Each is a small box positioned over the
  // crop rect's perimeter; the handle's data-edge identifies which sides it
  // controls when dragged.
  type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const handles: Partial<Record<Edge, HTMLElement>> = {};
  const handleStyle = 'absolute w-3 h-3 -mt-1.5 -ml-1.5 rounded-sm bg-white/95 border border-zinc-700';
  const edgeCursor: Record<Edge, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
  for (const e of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Edge[]) {
    const h = document.createElement('div');
    h.className = handleStyle;
    h.style.cursor = edgeCursor[e];
    h.dataset.edge = e;
    handles[e] = h;
    cropRect.appendChild(h);
  }
  cropEditor.append(cropHeading, cropContainer);
  gridRight.appendChild(cropEditor);

  // Default crop covers the whole image (no crop). Stored as normalised
  // 0..1 over the *natural* image dimensions, so it survives resolution
  // changes.
  function ensureCrop(): { left: number; top: number; right: number; bottom: number } {
    if (!opts.crop) opts.crop = { left: 0, top: 0, right: 1, bottom: 1 };
    return opts.crop;
  }
  function clampCrop(c: { left: number; top: number; right: number; bottom: number }, lockAspect: number | null): void {
    const minSize = 0.05; // never let crop shrink below 5% of an edge
    c.left = Math.max(0, Math.min(1 - minSize, c.left));
    c.top = Math.max(0, Math.min(1 - minSize, c.top));
    c.right = Math.max(c.left + minSize, Math.min(1, c.right));
    c.bottom = Math.max(c.top + minSize, Math.min(1, c.bottom));
    if (lockAspect) {
      // Aspect lock is in image pixels (natural width / natural height). Crop
      // normalised box uses fractions, so apply the natural-aspect ratio when
      // adjusting box height to box width.
      const naturalAspect = image ? image.width / image.height : 1;
      const targetHFrac = ((c.right - c.left) * naturalAspect) / lockAspect;
      // Try keeping the centre y the same as the user dragged; clamp if it
      // would push past 0..1.
      const cy = (c.top + c.bottom) / 2;
      let top = cy - targetHFrac / 2;
      let bot = cy + targetHFrac / 2;
      if (top < 0) { top = 0; bot = targetHFrac; }
      if (bot > 1) { bot = 1; top = 1 - targetHFrac; }
      c.top = Math.max(0, top);
      c.bottom = Math.min(1, bot);
    }
  }
  function lockAspectForShape(): number | null {
    // For circle, we want the crop to be a 1:1 box (in image pixels) so the
    // inscribed circle covers the whole crop. Other shapes leave aspect free.
    if (opts.mode === 'quantized' && opts.quantized.output === 'flat' && opts.quantized.shape === 'circle') return 1;
    return null;
  }
  function renderCrop(): void {
    if (!image) { cropEditor.classList.add('hidden'); return; }
    if (svgText) { cropEditor.classList.add('hidden'); return; }
    cropEditor.classList.remove('hidden');
    const c = ensureCrop();
    const lpct = c.left * 100;
    const tpct = c.top * 100;
    const wpct = (c.right - c.left) * 100;
    const hpct = (c.bottom - c.top) * 100;
    cropRect.style.left = `${lpct}%`;
    cropRect.style.top = `${tpct}%`;
    cropRect.style.width = `${wpct}%`;
    cropRect.style.height = `${hpct}%`;
    dimTop.style.left = '0'; dimTop.style.top = '0'; dimTop.style.width = '100%'; dimTop.style.height = `${tpct}%`;
    dimBottom.style.left = '0'; dimBottom.style.top = `${tpct + hpct}%`; dimBottom.style.width = '100%'; dimBottom.style.height = `${100 - (tpct + hpct)}%`;
    dimLeft.style.left = '0'; dimLeft.style.top = `${tpct}%`; dimLeft.style.width = `${lpct}%`; dimLeft.style.height = `${hpct}%`;
    dimRight.style.left = `${lpct + wpct}%`; dimRight.style.top = `${tpct}%`; dimRight.style.width = `${100 - (lpct + wpct)}%`; dimRight.style.height = `${hpct}%`;
    // Position handles at corners + edge midpoints.
    if (handles.nw) { handles.nw.style.left = '0%'; handles.nw.style.top = '0%'; }
    if (handles.ne) { handles.ne.style.left = '100%'; handles.ne.style.top = '0%'; }
    if (handles.sw) { handles.sw.style.left = '0%'; handles.sw.style.top = '100%'; }
    if (handles.se) { handles.se.style.left = '100%'; handles.se.style.top = '100%'; }
    if (handles.n) { handles.n.style.left = '50%'; handles.n.style.top = '0%'; }
    if (handles.s) { handles.s.style.left = '50%'; handles.s.style.top = '100%'; }
    if (handles.w) { handles.w.style.left = '0%'; handles.w.style.top = '50%'; }
    if (handles.e) { handles.e.style.left = '100%'; handles.e.style.top = '50%'; }
  }
  // Pointer-events drag on crop rect (move) and handles (resize). Working in
  // normalised crop space keeps the geometry tidy.
  let dragMode: { kind: 'move' | 'resize'; edge?: Edge; startX: number; startY: number; orig: { left: number; top: number; right: number; bottom: number } } | null = null;
  function startDrag(e: PointerEvent, kind: 'move' | 'resize', edge?: Edge): void {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragMode = { kind, edge, startX: e.clientX, startY: e.clientY, orig: { ...ensureCrop() } };
  }
  function moveDrag(e: PointerEvent): void {
    if (!dragMode) return;
    const rect = cropContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dxN = (e.clientX - dragMode.startX) / rect.width;
    const dyN = (e.clientY - dragMode.startY) / rect.height;
    const c = ensureCrop();
    const o = dragMode.orig;
    if (dragMode.kind === 'move') {
      const w = o.right - o.left;
      const h = o.bottom - o.top;
      c.left = o.left + dxN;
      c.top = o.top + dyN;
      c.right = c.left + w;
      c.bottom = c.top + h;
      // Move-clamp without aspect lock — moving never resizes.
      if (c.left < 0) { c.right -= c.left; c.left = 0; }
      if (c.top < 0) { c.bottom -= c.top; c.top = 0; }
      if (c.right > 1) { c.left -= (c.right - 1); c.right = 1; }
      if (c.bottom > 1) { c.top -= (c.bottom - 1); c.bottom = 1; }
    } else if (dragMode.edge) {
      const edge = dragMode.edge;
      if (edge.includes('n')) c.top = o.top + dyN;
      if (edge.includes('s')) c.bottom = o.bottom + dyN;
      if (edge.includes('w')) c.left = o.left + dxN;
      if (edge.includes('e')) c.right = o.right + dxN;
      clampCrop(c, lockAspectForShape());
    }
    renderCrop();
    schedulePreview();
  }
  function endDrag(e: PointerEvent): void {
    if (!dragMode) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragMode = null;
  }
  cropRect.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const edge = target.dataset.edge as Edge | undefined;
    if (edge) startDrag(e, 'resize', edge);
    else startDrag(e, 'move');
  });
  cropRect.addEventListener('pointermove', moveDrag);
  cropRect.addEventListener('pointerup', endDrag);
  cropRect.addEventListener('pointercancel', endDrag);

  // --- Live preview --------------------------------------------------------
  const previewWrap = document.createElement('div');
  previewWrap.className = 'flex flex-col items-center gap-2 border-t border-zinc-700 pt-3 md:border-0 md:pt-0';

  const previewRow = document.createElement('div');
  // Stack the 2D + 3D previews vertically inside the narrow right column so
  // both stay readable without resizing.
  previewRow.className = 'flex flex-col items-center gap-2';

  const canvas = document.createElement('canvas');
  canvas.className = 'rounded border border-zinc-700 bg-zinc-900 max-w-full';
  canvas.style.imageRendering = 'pixelated';

  // Small Three.js viewport — a low-res render of the actual tile mesh as a
  // sanity check on how the chamfer, holes, and silhouette will look in 3D.
  const preview3DWrap = document.createElement('div');
  preview3DWrap.className = 'flex flex-col items-center gap-1';
  const preview3D = document.createElement('canvas');
  preview3D.width = 200;
  preview3D.height = 200;
  preview3D.className = 'rounded border border-zinc-700 bg-zinc-900';
  preview3D.style.width = '200px';
  preview3D.style.height = '200px';
  const preview3DCaption = document.createElement('div');
  preview3DCaption.className = 'text-[10px] text-zinc-500 font-mono';
  preview3DCaption.textContent = '3D preview';
  preview3DWrap.append(preview3D, preview3DCaption);

  previewRow.append(canvas, preview3DWrap);

  const stat = document.createElement('div');
  stat.className = 'text-[11px] text-zinc-400 font-mono';
  stat.textContent = 'Load an image to preview.';

  previewWrap.append(previewRow, stat);
  gridRight.appendChild(previewWrap);

  // --- 3D preview state ---------------------------------------------------
  const three = init3DPreview(preview3D);
  let preview3DTimer: number | undefined;
  function schedule3DPreview(): void {
    if (preview3DTimer !== undefined) window.clearTimeout(preview3DTimer);
    preview3DTimer = window.setTimeout(render3DPreview, PREVIEW_3D_DEBOUNCE_MS);
  }
  async function render3DPreview(): Promise<void> {
    if (!image && !svgText) {
      three.setMesh(null);
      return;
    }
    try {
      // Build at a low resolution so options-tweak feels snappy. Quality
      // previews are the studio's job.
      const previewOpts: ReliefOptions = structuredClone(opts);
      previewOpts.common.resolution = Math.min(opts.common.resolution, PREVIEW_3D_RESOLUTION);
      const result = svgText
        ? await generateReliefFromSvg(svgText, previewOpts)
        : generateRelief(image!, previewOpts);
      three.setMesh(result.mesh, result.seedRegions, previewOpts.common.widthMm);
    } catch {
      // Generation can fail mid-tweak (e.g. while parsing SVG); leave the
      // previous render in place rather than flashing an error.
    }
  }

  // Click the preview to drop a hole at that point. The canvas drew the tile
  // centred at (halfW, halfH), so reverse that to get model-space (cxMm, cyMm).
  // Holes only make sense for tile outputs (flat/silhouette) — relief mode has
  // no fixed perimeter to cut into.
  canvas.addEventListener('click', (e) => {
    const isTile = svgText !== null || (opts.mode === 'quantized' && opts.quantized.output !== 'relief');
    if (!isTile) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const fx = (e.clientX - rect.left) / rect.width;
    // Canvas Y grows downward; the preview drew row 0 at the BOTTOM (the
    // downsampler flips for 3D coords), so display Y also grows downward
    // from the tile's top. Reverse it: top of canvas → +cyMm at +halfH.
    const fy = (e.clientY - rect.top) / rect.height;
    const widthMm = opts.common.widthMm;
    const halfW = widthMm / 2;
    // Use the source image aspect to guess heightMm (the geometry uses the
    // same aspect via grid H/W). Falls back to square when there's no image.
    const aspect = image ? image.height / Math.max(1, image.width)
      : svgText ? 1 : 1;
    const heightMm = widthMm * aspect;
    const halfH = heightMm / 2;
    const cxMm = -halfW + fx * widthMm;
    const cyMm = halfH - fy * heightMm;
    opts.quantized.holes = [...opts.quantized.holes, { cxMm, cyMm, diameterMm: 6 }];
    renderHoles();
    schedulePreview();
  });

  // --- AI assist button (in the body, above the footer) --------------------
  let aiBtn: HTMLButtonElement | undefined;
  if (options.aiAvailable) {
    aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'self-start px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-default';
    aiBtn.textContent = '✦ Auto-tune';
    aiBtn.title = 'Pick sensible defaults from the image’s contrast and saturation';
    aiBtn.addEventListener('click', runAiAssist);
    shell.body.appendChild(aiBtn);
  }

  // --- Footer --------------------------------------------------------------
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => shell.close());

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = BUTTON_PRIMARY;
  // Initial label set explicitly; syncMode() keeps it in sync as the user
  // changes mode/output/file from there on.
  createBtn.textContent = 'Create tile';
  createBtn.addEventListener('click', runCreate);

  shell.footer.append(cancelBtn, createBtn);

  // --- File handling -------------------------------------------------------
  // Increments on every file pick so stale async load callbacks (e.g. a slow
  // SVG render that finishes after the user already moved on to a PNG) abort
  // before writing their state into the modal.
  let loadToken = 0;

  // Load logic factored out so both the file-input change handler and
  // `options.initialFile` (a recent-imports re-click) drive the same code path.
  async function loadFile(file: File): Promise<void> {
    const myToken = ++loadToken;
    const stale = (): boolean => myToken !== loadToken;
    pickedFile = file;
    baseName = file.name.replace(/\.[^.]+$/, '') || 'relief';

    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    if (isSvg) {
      let text: string;
      try { text = await file.text(); }
      catch { if (!stale()) { svgText = null; image = null; sourceLabel.textContent = 'Could not read SVG'; syncEnabled(); } return; }
      if (stale()) return;
      svgText = text;
      image = null;
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(blob);
      const svgLoader = new Image();
      svgLoader.addEventListener('load', () => {
        if (stale()) { URL.revokeObjectURL(svgUrl); return; }
        const off = document.createElement('canvas');
        off.width = Math.max(1, svgLoader.naturalWidth || 200);
        off.height = Math.max(1, svgLoader.naturalHeight || 200);
        const ctx = off.getContext('2d');
        if (ctx) ctx.drawImage(svgLoader, 0, 0, off.width, off.height);
        URL.revokeObjectURL(svgUrl);
        thumb.classList.remove('hidden');
        thumb.src = off.toDataURL('image/png');
        sourceLabel.textContent = `${baseName} — SVG ${off.width}×${off.height}`;
        renderPreview();
        syncMode();
        syncEnabled();
      });
      svgLoader.addEventListener('error', () => {
        URL.revokeObjectURL(svgUrl);
        if (stale()) return;
        sourceLabel.textContent = 'Could not render SVG';
        syncEnabled();
      });
      svgLoader.src = svgUrl;
      return;
    }

    svgText = null;
    const url = URL.createObjectURL(file);
    const loader = new Image();
    loader.addEventListener('load', () => {
      if (stale()) { URL.revokeObjectURL(url); return; }
      const off = document.createElement('canvas');
      off.width = loader.naturalWidth;
      off.height = loader.naturalHeight;
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.drawImage(loader, 0, 0);
        try {
          image = ctx.getImageData(0, 0, off.width, off.height);
        } catch {
          image = null;
        }
      }
      URL.revokeObjectURL(url);
      thumb.src = '';
      thumb.classList.remove('hidden');
      const thumbSrc = off.toDataURL('image/png');
      thumb.src = thumbSrc;
      cropImg.src = thumbSrc;
      // Reset crop to the full image when a new source is picked. We don't
      // know the user's intent for the new picture, so a fresh import starts
      // uncropped.
      if (!options.initialOptions?.crop) opts.crop = { left: 0, top: 0, right: 1, bottom: 1 };
      renderCrop();
      sourceLabel.textContent = `${baseName} — ${off.width}×${off.height}`;
      renderPreview();
      syncMode();
      syncEnabled();
    });
    loader.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      if (stale()) return;
      image = null;
      sourceLabel.textContent = 'Could not read image';
      syncEnabled();
    });
    loader.src = url;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
  });

  // Drag-and-drop a file anywhere on the modal body. preventDefault on
  // dragover/drop keeps the browser from navigating to the file URL.
  shell.body.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      shell.body.classList.add('ring-2', 'ring-blue-500/60');
    }
  });
  shell.body.addEventListener('dragleave', (e) => {
    if (e.target === shell.body) shell.body.classList.remove('ring-2', 'ring-blue-500/60');
  });
  shell.body.addEventListener('drop', (e) => {
    e.preventDefault();
    shell.body.classList.remove('ring-2', 'ring-blue-500/60');
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadFile(file);
  });

  // Click-to-pick background colour for silhouette mode. The user clicks the
  // source thumbnail at a representative background pixel; the picked colour
  // overrides detectBackgroundMask's edge-frequency heuristic.
  thumb.addEventListener('click', (e) => {
    if (!image || opts.quantized.output !== 'silhouette') return;
    const rect = thumb.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const ix = Math.max(0, Math.min(image.width - 1, Math.floor(fx * image.width)));
    const iy = Math.max(0, Math.min(image.height - 1, Math.floor(fy * image.height)));
    const idx = (iy * image.width + ix) * 4;
    opts.quantized.manualBackground = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
    syncMode();
    renderPreview();
  });

  if (options.initialFile) void loadFile(options.initialFile);

  // --- AI assist flow ------------------------------------------------------
  async function runAiAssist(): Promise<void> {
    if (!aiBtn || !image || !options.onAiAssist) return;
    aiBtn.disabled = true;
    const original = aiBtn.textContent;
    aiBtn.textContent = '✦ Tuning…';
    try {
      const result = await options.onAiAssist(image, opts);
      mergeOptions(opts, result);
      if (result.note) {
        aiNote.textContent = result.note;
        aiNote.classList.remove('hidden');
      }
      refreshControls();
      syncMode();
      renderPreview();
    } catch (err) {
      aiNote.textContent = `Auto-tune failed: ${err instanceof Error ? err.message : String(err)}`;
      aiNote.classList.remove('hidden');
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = original;
    }
  }

  // --- Create flow ---------------------------------------------------------
  async function runCreate(): Promise<void> {
    if ((!image && !svgText) || creating) return;
    creating = true;
    createBtn.disabled = true;
    createBtn.classList.add('opacity-60', 'cursor-default');
    const original = createBtn.textContent;
    createBtn.textContent = 'Generating…';
    try {
      if (svgText) {
        if (!options.onCreateSvg) throw new Error('SVG imports are not enabled in this build');
        await options.onCreateSvg(svgText, opts, baseName);
      } else if (image) {
        await options.onCreate(image, opts, baseName);
      }
      // Record the source file + the settings the user chose in the recent
      // imports inbox. The inbox dedupes on (filename, settings), so the same
      // image with the same tweaks just bubbles to the top instead of stacking
      // a new entry; tweaking any knob produces a separate entry.
      if (pickedFile) {
        try {
          const meta: ImportMetadata = { importer: 'relief', options: structuredClone(opts) };
          const thumbnail = await createThumbnailFromBlob(pickedFile);
          registerImport(pickedFile, pickedFile.name, svgText ? 'SVG' : 'IMAGE', meta, thumbnail);
        } catch { /* best-effort, recents are nice-to-have */ }
      }
      shell.close();
    } catch (err) {
      creating = false;
      createBtn.disabled = false;
      createBtn.classList.remove('opacity-60', 'cursor-default');
      createBtn.textContent = original;
      aiNote.textContent = `Create failed: ${err instanceof Error ? err.message : String(err)}`;
      aiNote.classList.remove('hidden');
    }
  }

  // --- Preview rendering ---------------------------------------------------
  function schedulePreview(): void {
    if (previewTimer !== undefined) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, DEBOUNCE_MS);
    schedule3DPreview();
  }

  function renderPreview(): void {
    // Keep the 3D preview in sync whenever the 2D one updates — the two
    // surface different facets (cluster map vs. realised mesh) of the same
    // option set. syncMode re-evaluates the painting-mode-fit hint too.
    schedule3DPreview();
    syncMode();
    if (svgText) {
      // SVG mode: the source is shown in the thumbnail and each <path fill>
      // becomes its own crisp region — there's no luminance/cluster grid to
      // preview here, so collapse the canvas and update the stat caption.
      canvas.width = 1; canvas.height = 1;
      canvas.style.width = '1px'; canvas.style.height = '1px';
      stat.textContent = `SVG · per-fill rasterisation at ${Math.floor(opts.common.resolution)} cols`;
      return;
    }
    if (!image) return;
    const grid = sampleImageToGrid(image, opts);
    const w = grid.width;
    const h = grid.height;
    canvas.width = w;
    canvas.height = h;
    // Display size: fit the long edge into PREVIEW_PX, preserving aspect.
    const scale = PREVIEW_PX / Math.max(w, h);
    canvas.style.width = `${Math.round(w * scale)}px`;
    canvas.style.height = `${Math.round(h * scale)}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const out = ctx.createImageData(w, h);
    const data = out.data;
    const maxH = opts.common.maxHeight > 0 ? opts.common.maxHeight : 1;

    // The grid is built bottom-row-first (downsample flips Y so the 3D mesh
    // renders right-side-up). The 2D preview canvas writes row 0 at the top,
    // so we read from grid row (h-1-py) when filling canvas row py to undo
    // that flip — otherwise the preview shows the image upside-down.
    if (opts.mode === 'quantized' && grid.colors) {
      const colors = grid.colors;
      for (let py = 0; py < h; py++) {
        const sy = h - 1 - py;
        for (let px = 0; px < w; px++) {
          const src = (sy * w + px) * 3;
          const dst = (py * w + px) * 4;
          data[dst] = colors[src];
          data[dst + 1] = colors[src + 1];
          data[dst + 2] = colors[src + 2];
          data[dst + 3] = 255;
        }
      }
    } else {
      for (let py = 0; py < h; py++) {
        const sy = h - 1 - py;
        for (let px = 0; px < w; px++) {
          const g = Math.max(0, Math.min(255, Math.round((grid.heights[sy * w + px] / maxH) * 255)));
          const dst = (py * w + px) * 4;
          data[dst] = g;
          data[dst + 1] = g;
          data[dst + 2] = g;
          data[dst + 3] = 255;
        }
      }
    }
    // Overlay the final tile shape: cells outside the silhouette/shape or
    // inside the keychain hole get a checkerboard "cut" indicator so the
    // user previews what they'll actually print (rounded corners, circles,
    // the hole, silhouette cut). A checkerboard reads as transparent/cut at a
    // glance, where a solid dark fill was just looking like dark content.
    const keep = computePreviewKeepMask(grid, opts);
    if (keep) {
      for (let py = 0; py < h; py++) {
        const sy = h - 1 - py;
        for (let px = 0; px < w; px++) {
          if (keep[sy * w + px] === 0) {
            const dst = (py * w + px) * 4;
            const checker = ((px >> 1) + (py >> 1)) & 1;
            const v = checker ? 64 : 36;
            data[dst] = v; data[dst + 1] = v; data[dst + 2] = v + 4; data[dst + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(out, 0, 0);

    const detail = opts.mode === 'quantized'
      ? `${opts.quantized.clusters} clusters`
      : `${opts.luminance.levels} levels`;
    // Caption: this is a SAMPLED preview — the geometry will look identical at
    // the chosen resolution, but real corner/silhouette/hole cuts are now
    // overlaid here too.
    stat.textContent = `Preview · ${w}×${h} · ${detail}`;
  }

  // Returns a per-cell mask (1 = keep, 0 = cut) reflecting the tile's shape,
  // silhouette, and hole choices. Returns null when nothing is cut (no overlay
  // needed and we save the per-cell pass). Bottom-row-first to match the grid.
  function computePreviewKeepMask(grid: HeightGrid, o: ReliefOptions): Uint8Array | null {
    const w = grid.width, h = grid.height;
    const isQ = o.mode === 'quantized';
    const out = isQ ? o.quantized.output : 'relief';
    const shape = isQ ? o.quantized.shape : 'rect';
    const hasShape = isQ && out === 'flat' && (shape === 'rounded' || shape === 'circle');
    const hasSilhouette = isQ && out === 'silhouette' && !!grid.colors;
    const holes = isQ ? o.quantized.holes : [];
    const hasHole = holes.length > 0;
    if (!hasShape && !hasSilhouette && !hasHole) return null;

    const widthMm = o.common.widthMm;
    const heightMm = widthMm * (h / w);
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;
    const dx = w > 1 ? widthMm / (w - 1) : 0;
    const dy = h > 1 ? heightMm / (h - 1) : 0;

    const mask = new Uint8Array(w * h);
    if (hasSilhouette && grid.colors) {
      const mb = o.quantized.manualBackground;
      mask.set(mb ? bgMaskFromColor(grid.colors, w, h, mb) : detectBackgroundMask(grid.colors, w, h));
    } else {
      mask.fill(1);
    }

    if (hasShape) {
      const r = shape === 'circle'
        ? Math.min(halfW, halfH)
        : Math.min(Math.max(0, o.quantized.cornerRadiusMm), Math.min(halfW, halfH));
      for (let y = 0; y < h; y++) {
        const cy = -halfH + (y + 0.5) * dy;
        for (let x = 0; x < w; x++) {
          if (mask[y * w + x] === 0) continue;
          const cx = -halfW + (x + 0.5) * dx;
          let inside: boolean;
          if (shape === 'circle') {
            inside = cx * cx + cy * cy <= r * r;
          } else {
            const ax = Math.abs(cx), ay = Math.abs(cy);
            if (ax > halfW || ay > halfH) inside = false;
            else {
              const ix = Math.max(0, ax - (halfW - r));
              const iy = Math.max(0, ay - (halfH - r));
              inside = ix * ix + iy * iy <= r * r;
            }
          }
          if (!inside) mask[y * w + x] = 0;
        }
      }
    }

    for (const hole of holes) {
      const rHole = hole.diameterMm / 2;
      if (rHole <= 0) continue;
      for (let y = 0; y < h; y++) {
        const cy = -halfH + (y + 0.5) * dy - hole.cyMm;
        for (let x = 0; x < w; x++) {
          if (mask[y * w + x] === 0) continue;
          const cx = -halfW + (x + 0.5) * dx - hole.cxMm;
          if (cx * cx + cy * cy <= rHole * rHole) mask[y * w + x] = 0;
        }
      }
    }
    return mask;
  }

  // --- UI sync helpers -----------------------------------------------------
  function syncMode(): void {
    const isSvg = svgText !== null;
    // Hide the 'Stepped relief' Output option for SVG — generateReliefFromSvg
    // ignores it and emits a flat tile, so dangling it in the dropdown is a
    // UX lie. If an SVG happens to be loaded with output already set to
    // 'relief' (from initialOptions on a re-import), snap it back to the SVG
    // default 'silhouette' so the visible selection matches what will run.
    if (outputReliefOption) outputReliefOption.hidden = isSvg;
    if (isSvg && opts.quantized.output === 'relief') opts.quantized.output = 'silhouette';
    for (const [id, btn] of modeButtons) {
      const active = id === opts.mode;
      btn.classList.toggle('bg-blue-600', active && !isSvg);
      btn.classList.toggle('text-white', active && !isSvg);
      btn.classList.toggle('bg-zinc-800', (!active || isSvg) && !btn.disabled);
      btn.classList.toggle('text-zinc-300', (!active || isSvg) && !btn.disabled);
      // SVG imports have a fixed pipeline (per-fill regions) — mode tabs don't
      // apply, so dim them and ignore clicks while an SVG is loaded.
      btn.classList.toggle('opacity-40', isSvg && !btn.disabled);
      btn.classList.toggle('pointer-events-none', isSvg);
    }
    const showLum = !isSvg && opts.mode === 'luminance';
    luminanceSection.root.classList.toggle('hidden', !showLum);
    quantizedSection.root.classList.toggle('hidden', isSvg || opts.mode !== 'quantized');
    tileSection.root.classList.toggle('hidden', !isSvg && opts.mode !== 'quantized');
    // Painting mode picker only applies to stepped reliefs. Flat / silhouette
    // tiles paint their top 1:1 from the cluster map, so the choice is moot.
    const showPaintingMode = !isSvg && opts.mode === 'quantized' && opts.quantized.output === 'relief';
    paintingModeRow.classList.toggle('hidden', !showPaintingMode);
    // Same gating for the invert-heights toggle — it only changes the
    // cluster→Z mapping for stepped reliefs.
    invertHeightsRow.classList.toggle('hidden', !showPaintingMode);
    // Layer-fit hint — visible only when single-nozzle stepped relief would
    // pile two clusters into one Z-band given the current settings. syncEnabled
    // is what actually toggles createBtn.disabled; here we just paint the
    // amber explainer.
    const showFit = showPaintingMode && opts.quantized.paintingMode === 'single-nozzle';
    const fits = layersFitForSingleNozzle();
    layerFitHint.classList.toggle('hidden', !showFit || fits);
    if (showFit && !fits) {
      const lh = opts.common.layerHeight;
      const minMaxHeight = (opts.quantized.clusters - 1) * lh;
      layerFitHint.textContent = `Max height ${opts.common.maxHeight.toFixed(2)} mm is too low for ${opts.quantized.clusters} clusters at ${lh} mm layers — two filaments would have to swap inside one print layer. Raise max height to ≥ ${minMaxHeight.toFixed(2)} mm or reduce the cluster count.`;
    }
    createBtn.textContent = currentCtaLabel();
    syncEnabled();

    // Silhouette mode: the thumb becomes click-to-pick background. Cursor
    // hint + show the picked-colour indicator when set.
    const silhouettePickable = !isSvg && opts.mode === 'quantized' && opts.quantized.output === 'silhouette' && image !== null;
    thumb.classList.toggle('cursor-crosshair', silhouettePickable);
    thumb.title = silhouettePickable ? 'Click to set the background colour' : '';
    const mb = opts.quantized.manualBackground;
    bgPickWrap.classList.toggle('hidden', !mb || !silhouettePickable);
    if (mb) bgPickSwatch.style.backgroundColor = `rgb(${mb[0]}, ${mb[1]}, ${mb[2]})`;

    // Crop editor: only for raster imports (SVGs are already vector-clean) and
    // hidden until an image is loaded. Aspect lock to 1:1 for circle shape so
    // the inscribed circle fills the crop region.
    const lockAspect = lockAspectForShape();
    if (lockAspect && image && opts.crop) clampCrop(opts.crop, lockAspect);
    renderCrop();

    // Preview canvas: clickable to drop a hole in tile modes only.
    const tilePickable = isSvg || (opts.mode === 'quantized' && opts.quantized.output !== 'relief');
    canvas.style.cursor = tilePickable ? 'crosshair' : 'default';
    canvas.title = tilePickable ? 'Click to drop a keychain hole' : '';
  }

  // Primary CTA label tracks the actual thing we're about to create — "Create
  // relief" used to fire even when the user had picked a flat colour tile,
  // which set the wrong expectation for the result.
  function currentCtaLabel(): string {
    if (svgText) return 'Create from SVG';
    if (opts.mode === 'luminance') return 'Create relief';
    switch (opts.quantized.output) {
      case 'flat': return 'Create tile';
      case 'silhouette': return 'Create silhouette';
      case 'relief': return 'Create relief';
    }
  }

  function layersFitForSingleNozzle(): boolean {
    const isSvg = svgText !== null;
    if (isSvg) return true; // SVG output is silhouette/flat, not stepped relief
    if (opts.mode !== 'quantized') return true;
    if (opts.quantized.output !== 'relief') return true;
    if (opts.quantized.paintingMode !== 'single-nozzle') return true;
    const minMaxHeight = (opts.quantized.clusters - 1) * opts.common.layerHeight;
    return opts.common.maxHeight + 1e-6 >= minMaxHeight;
  }
  function syncEnabled(): void {
    const ready = image !== null || svgText !== null;
    const fits = layersFitForSingleNozzle();
    createBtn.disabled = !ready || creating || !fits;
    createBtn.classList.toggle('opacity-60', !ready || !fits);
    createBtn.classList.toggle('cursor-default', !ready || !fits);
    // AI assist tunes raster-clustering knobs; it has nothing to say about SVG.
    if (aiBtn) aiBtn.disabled = !ready || svgText !== null;
  }

  // --- Initial paint -------------------------------------------------------
  syncMode();
  syncEnabled();

  // Small local control factories. Each registers a refresher so AI-assisted
  // option changes flow back into the widgets.

  function makeSection(title: string): { root: HTMLDivElement; grid: HTMLDivElement } {
    const root = document.createElement('div');
    root.className = 'flex flex-col gap-2';
    const heading = document.createElement('div');
    heading.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500';
    heading.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-x-4 gap-y-2.5';
    root.append(heading, grid);
    return { root, grid };
  }

  function fieldWrap(label: string, unit: string): { wrap: HTMLDivElement; labelRow: HTMLDivElement; valueEl: HTMLSpanElement } {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1';
    const labelRow = document.createElement('div');
    labelRow.className = 'flex items-baseline justify-between gap-2';
    const name = document.createElement('label');
    name.className = 'text-[11px] text-zinc-300';
    name.textContent = unit ? `${label} (${unit})` : label;
    const valueEl = document.createElement('span');
    valueEl.className = 'text-[11px] text-zinc-500 font-mono';
    labelRow.append(name, valueEl);
    wrap.appendChild(labelRow);
    return { wrap, labelRow, valueEl };
  }

  function numberControl(
    parent: HTMLElement,
    label: string,
    unit: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number },
  ): void {
    const { wrap, valueEl } = fieldWrap(label, unit);
    valueEl.remove();
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(get());
    input.className = 'w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-blue-500';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      set(v);
      schedulePreview();
    });
    controlRefreshers.push(() => { input.value = String(get()); });
    wrap.appendChild(input);
    parent.appendChild(wrap);
  }

  function sliderControl(
    parent: HTMLElement,
    label: string,
    unit: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number; int?: boolean },
  ): void {
    // Slider for dragged exploration, plus a typeable number input for exact
    // entry. Two-way bound and clamped to the slider's range.
    const { wrap, labelRow, valueEl } = fieldWrap(label, unit);
    valueEl.remove();
    const fmt = (v: number) => (range.int ? String(Math.round(v)) : v.toFixed(2));
    const numEl = document.createElement('input');
    numEl.type = 'number';
    // Number input deliberately omits `max` so the user can type a value
    // larger than the slider visually allows (matching the freehand pattern
    // used elsewhere in the app — main.ts's clampReliefCommon enforces a
    // hard upper bound at create time).
    numEl.min = String(range.min);
    numEl.step = String(range.step);
    numEl.value = fmt(get());
    numEl.className = 'w-16 px-1.5 py-0.5 text-[11px] bg-zinc-900 border border-zinc-700/60 rounded text-zinc-200 text-right tabular-nums focus:outline-none focus:border-blue-500';
    labelRow.appendChild(numEl);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(get());
    input.className = 'w-full accent-blue-500 cursor-pointer';
    const onSlider = (): void => {
      const v = range.int ? Math.round(Number(input.value)) : Number(input.value);
      set(v);
      numEl.value = fmt(v);
      schedulePreview();
    };
    const onNumber = (): void => {
      let v = Number(numEl.value);
      if (!Number.isFinite(v)) { numEl.value = fmt(get()); return; }
      if (range.int) v = Math.round(v);
      // Floor at range.min (typed negatives would break downstream consumers),
      // but accept values larger than range.max — the slider just pins at its
      // visual max while the underlying value carries the user's input.
      if (v < range.min) v = range.min;
      set(v);
      input.value = String(Math.min(v, range.max));
      numEl.value = fmt(v);
      schedulePreview();
    };
    input.addEventListener('input', onSlider);
    numEl.addEventListener('change', onNumber);
    numEl.addEventListener('blur', onNumber);
    numEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onNumber(); numEl.blur(); } });
    controlRefreshers.push(() => {
      input.value = String(get());
      numEl.value = fmt(get());
    });
    wrap.appendChild(input);
    parent.appendChild(wrap);
  }

  function checkboxControl(
    parent: HTMLElement,
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-2 cursor-pointer self-end h-full';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.className = 'w-4 h-4 accent-blue-500 cursor-pointer';
    input.addEventListener('change', () => {
      set(input.checked);
      schedulePreview();
    });
    controlRefreshers.push(() => { input.checked = get(); });
    const text = document.createElement('span');
    text.className = 'text-[11px] text-zinc-300';
    text.textContent = label;
    row.append(input, text);
    parent.appendChild(row);
    return row;
  }

  function selectControl<T extends string>(
    parent: HTMLElement,
    label: string,
    get: () => T,
    set: (v: T) => void,
    choices: Array<{ value: T; label: string }>,
  ): HTMLElement {
    const { wrap } = fieldWrap(label, '');
    const select = document.createElement('select');
    select.className = 'w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-blue-500';
    for (const c of choices) {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label;
      select.appendChild(opt);
    }
    select.value = get();
    select.addEventListener('change', () => {
      set(select.value as T);
      schedulePreview();
    });
    controlRefreshers.push(() => { select.value = get(); });
    wrap.appendChild(select);
    parent.appendChild(wrap);
    return wrap;
  }
}

interface Preview3D {
  setMesh(mesh: ReliefMesh | null, seeds?: SeedRegion[], widthMm?: number): void;
  dispose(): void;
}

// Wire a small Three.js scene to a canvas. The returned handle accepts new
// meshes from the wizard and frames them. Auto-rotates so the user sees all
// sides without orbit controls; cleans up renderer + GPU resources on dispose.
function init3DPreview(canvas: HTMLCanvasElement): Preview3D {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    // WebGL unavailable (rare on sandbox / headless). Skip 3D preview entirely;
    // the rest of the wizard still works without it.
    return { setMesh() { /* noop */ }, dispose() { /* noop */ } };
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setClearColor(0x18181b, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 5000);
  camera.position.set(0, -120, 80);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(80, -120, 140);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-100, 60, 60);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);
  let currentMesh: THREE.Mesh | null = null;
  let disposed = false;

  function clearMesh(): void {
    if (!currentMesh) return;
    group.remove(currentMesh);
    currentMesh.geometry.dispose();
    const mat = currentMesh.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat.dispose();
    currentMesh = null;
  }

  // Apply seed-region colours as per-vertex colours by tagging each triangle's
  // three vertices with the region colour. Cheap and accurate enough for the
  // preview — for the studio's full-fidelity preview we still use the real
  // paint regions on the actual mesh.
  function paintVertexColors(geom: THREE.BufferGeometry, mesh: ReliefMesh, seeds: SeedRegion[] | undefined): void {
    const colors = new Float32Array(mesh.numVert * 3);
    // Default ash colour so unpainted bottom/walls aren't black.
    for (let i = 0; i < mesh.numVert; i++) {
      colors[i * 3] = 0.72; colors[i * 3 + 1] = 0.72; colors[i * 3 + 2] = 0.72;
    }
    if (seeds) {
      for (const seed of seeds) {
        const [r, g, b] = seed.color;
        for (const triId of seed.triangleIds) {
          for (let k = 0; k < 3; k++) {
            const vid = mesh.triVerts[triId * 3 + k];
            colors[vid * 3] = r; colors[vid * 3 + 1] = g; colors[vid * 3 + 2] = b;
          }
        }
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function setMesh(mesh: ReliefMesh | null, seeds?: SeedRegion[], widthMm?: number): void {
    // Async render races can resolve AFTER dispose() — the wizard was closed
    // while generateReliefFromSvg awaited. Without this guard we'd allocate a
    // BufferGeometry + MeshStandardMaterial into a torn-down scene and leak
    // them (clearMesh + dispose already ran).
    if (disposed) return;
    clearMesh();
    if (!mesh || mesh.numTri === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3));
    geom.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
    paintVertexColors(geom, mesh, seeds);
    geom.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    currentMesh = new THREE.Mesh(geom, material);
    group.add(currentMesh);
    // Frame the camera to the mesh extents so any aspect / chamfer sits inside
    // the viewport.
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, (bb.max.z - bb.min.z) * 2);
    const fitDistance = (span * 0.75) / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, -fitDistance, fitDistance * 0.55);
    camera.lookAt(0, 0, (bb.max.z + bb.min.z) / 2);
    void widthMm;
  }

  let rafId = 0;
  const t0 = performance.now();
  function tick(): void {
    if (disposed) return;
    const t = (performance.now() - t0) / 1000;
    group.rotation.z = t * 0.25;
    renderer!.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function dispose(): void {
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    clearMesh();
    renderer!.dispose();
    // Force-release the WebGL context so a re-opened wizard doesn't pile up
    // contexts (browsers cap them around 8–16 per page).
    renderer!.forceContextLoss();
  }

  return { setMesh, dispose };
}

// Deep-merge an AI-returned partial into the working options. Only the four
// known nested groups are merged; the stray `note` field is ignored here.
function mergeOptions(target: ReliefOptions, patch: Partial<ReliefOptions> & { note?: string }): void {
  if (patch.mode) target.mode = patch.mode;
  if (patch.common) Object.assign(target.common, patch.common);
  if (patch.luminance) Object.assign(target.luminance, patch.luminance);
  if (patch.quantized) {
    Object.assign(target.quantized, patch.quantized);
    // Old saved presets carry `holeEnabled` + offset/diameter instead of holes[].
    // If the merge brought legacy fields in but no holes array, materialise the
    // single hole from them so the wizard reopens with the same cut-out.
    if ((!Array.isArray(patch.quantized.holes) || patch.quantized.holes.length === 0) && patch.quantized.holeEnabled) {
      const widthMm = target.common.widthMm;
      const heightMm = widthMm; // aspect unknown at merge time; cyMm is mm
      target.quantized.holes = [{
        cxMm: 0,
        cyMm: heightMm / 2 - (patch.quantized.holeOffsetMm ?? 6),
        diameterMm: patch.quantized.holeDiameterMm ?? 6,
      }];
    }
  }
  if (patch.preprocess) Object.assign(target.preprocess, patch.preprocess);
}
