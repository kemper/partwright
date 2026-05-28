// Wizard modal that turns an imported image into a HueForge-style relief
// (heightmap). The user picks an image, chooses a mapping mode, tunes the
// knobs, watches a live grayscale/colored preview, and clicks Create. Mesh
// generation itself is the host's job — this modal only resolves options and
// hands back the source ImageData via onCreate.

import type { ReliefOptions, ReliefImportMode, TileOutputKind, TileShapeKind, HeightGrid } from '../relief/types';
import { DEFAULT_RELIEF_OPTIONS } from '../relief/types';
import { sampleImageToGrid, detectBackgroundMask, bgMaskFromColor } from '../relief/imageToRelief';
import { registerImport } from '../import/importInbox';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

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
    maxWidth: 'xl',
    scrollable: true,
    onClose: () => {
      if (previewTimer !== undefined) window.clearTimeout(previewTimer);
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
  // picker switches between the stepped HueForge relief, a flat colour tile
  // (Bambu-keychain style), and a tile cut to the image's subject silhouette.
  const tileSection = makeSection('Tile output');
  selectControl<TileOutputKind>(tileSection.grid, 'Output', () => opts.quantized.output, v => { opts.quantized.output = v; syncMode(); }, [
    { value: 'flat', label: 'Flat tile (keychain)' },
    { value: 'silhouette', label: 'Cut to subject' },
    { value: 'relief', label: 'Stepped relief (HueForge)' },
  ]);
  selectControl<TileShapeKind>(tileSection.grid, 'Shape', () => opts.quantized.shape, v => (opts.quantized.shape = v), [
    { value: 'rect', label: 'Rectangle' },
    { value: 'rounded', label: 'Rounded' },
    { value: 'circle', label: 'Circle' },
  ]);
  sliderControl(tileSection.grid, 'Corner radius', 'mm', () => opts.quantized.cornerRadiusMm, v => (opts.quantized.cornerRadiusMm = v), { min: 0, max: 20, step: 0.5 });
  checkboxControl(tileSection.grid, 'Keychain hole', () => opts.quantized.holeEnabled, v => (opts.quantized.holeEnabled = v));
  sliderControl(tileSection.grid, 'Hole diameter', 'mm', () => opts.quantized.holeDiameterMm, v => (opts.quantized.holeDiameterMm = v), { min: 2, max: 15, step: 0.5 });
  sliderControl(tileSection.grid, 'Hole offset from edge', 'mm', () => opts.quantized.holeOffsetMm, v => (opts.quantized.holeOffsetMm = v), { min: 2, max: 40, step: 0.5 });

  knobs.append(imageSection.root, commonSection.root, luminanceSection.root, quantizedSection.root, tileSection.root);
  shell.body.append(aiNote, knobs);

  // --- Live preview --------------------------------------------------------
  const previewWrap = document.createElement('div');
  previewWrap.className = 'flex flex-col items-center gap-1.5 border-t border-zinc-700 pt-3';

  const canvas = document.createElement('canvas');
  canvas.className = 'rounded border border-zinc-700 bg-zinc-900 max-w-full';
  canvas.style.imageRendering = 'pixelated';

  const stat = document.createElement('div');
  stat.className = 'text-[11px] text-zinc-400 font-mono';
  stat.textContent = 'Load an image to preview.';

  previewWrap.append(canvas, stat);
  shell.body.appendChild(previewWrap);

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
      thumb.src = off.toDataURL('image/png');
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
        try { registerImport(pickedFile, pickedFile.name, svgText ? 'SVG' : 'IMAGE', structuredClone(opts)); }
        catch { /* best-effort, recents are nice-to-have */ }
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
  }

  function renderPreview(): void {
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
    const hasHole = isQ && o.quantized.holeEnabled;
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

    if (hasHole) {
      // Match tileMesh: hole sits on the centreline X=0, offset down from the
      // model's top edge (heightMm/2 - holeOffsetMm).
      const cxHole = 0;
      const cyHole = halfH - o.quantized.holeOffsetMm;
      const rHole = o.quantized.holeDiameterMm / 2;
      for (let y = 0; y < h; y++) {
        const cy = -halfH + (y + 0.5) * dy - cyHole;
        for (let x = 0; x < w; x++) {
          if (mask[y * w + x] === 0) continue;
          const cx = -halfW + (x + 0.5) * dx - cxHole;
          if (cx * cx + cy * cy <= rHole * rHole) mask[y * w + x] = 0;
        }
      }
    }
    return mask;
  }

  // --- UI sync helpers -----------------------------------------------------
  function syncMode(): void {
    const isSvg = svgText !== null;
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
    createBtn.textContent = currentCtaLabel();

    // Silhouette mode: the thumb becomes click-to-pick background. Cursor
    // hint + show the picked-colour indicator when set.
    const silhouettePickable = !isSvg && opts.mode === 'quantized' && opts.quantized.output === 'silhouette' && image !== null;
    thumb.classList.toggle('cursor-crosshair', silhouettePickable);
    thumb.title = silhouettePickable ? 'Click to set the background colour' : '';
    const mb = opts.quantized.manualBackground;
    bgPickWrap.classList.toggle('hidden', !mb || !silhouettePickable);
    if (mb) bgPickSwatch.style.backgroundColor = `rgb(${mb[0]}, ${mb[1]}, ${mb[2]})`;
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

  function syncEnabled(): void {
    const ready = image !== null || svgText !== null;
    createBtn.disabled = !ready || creating;
    createBtn.classList.toggle('opacity-60', !ready);
    createBtn.classList.toggle('cursor-default', !ready);
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
  ): void {
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
  }

  function selectControl<T extends string>(
    parent: HTMLElement,
    label: string,
    get: () => T,
    set: (v: T) => void,
    choices: Array<{ value: T; label: string }>,
  ): void {
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
  }
}

// Deep-merge an AI-returned partial into the working options. Only the three
// known nested groups are merged; the stray `note` field is ignored here.
function mergeOptions(target: ReliefOptions, patch: Partial<ReliefOptions> & { note?: string }): void {
  if (patch.mode) target.mode = patch.mode;
  if (patch.common) Object.assign(target.common, patch.common);
  if (patch.luminance) Object.assign(target.luminance, patch.luminance);
  if (patch.quantized) Object.assign(target.quantized, patch.quantized);
  if (patch.preprocess) Object.assign(target.preprocess, patch.preprocess);
}
