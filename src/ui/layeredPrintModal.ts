// "Layered print from photo" dialog — the non-AI front end to the layered-print (HueForge-style)
// solver. Pick a photo, set the colour count / size / height, solve (in a
// Worker), compare photo vs predicted print side by side with the filament
// stack + swap layers, then download the layer-swap 3MF or open the result as
// a session. main.ts owns the solve/commit/download callbacks; the same
// operations are on window.partwright (createLayeredPrint / exportLayeredPrint3MF).

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_CANCEL } from './styleConstants';
import { BAMBU_PRINTERS, DEFAULT_BAMBU_PRINTER } from '../export/threemfProject';
import type { LayeredPrintOptions, LayeredPrintResult, RgbaImage } from '../relief/layeredPrint/solver';
import type { LayeredExportMode } from '../relief/layeredPrint/export3mf';

export interface LayeredPrintModalOptions {
  /** Image URL (data: / blob: / http) to preload. */
  initialSrc?: string;
  /** Or a picked/dropped file to preload. */
  initialFile?: File;
  /** Decode + downscale a photo; `dataUrl` is what gets attached to the session. */
  decode: (src: Blob | string) => Promise<{ image: ImageData; dataUrl: string }>;
  solve: (image: RgbaImage, options: Partial<LayeredPrintOptions>, signal: AbortSignal) => Promise<LayeredPrintResult>;
  /** Open the solved print as a new code session with the photo attached. */
  onCreate: (result: LayeredPrintResult, name: string, photoDataUrl: string) => Promise<void>;
  /** Download a 3MF for the solve (the same export path as the editor's). */
  onDownload: (result: LayeredPrintResult, args: { mode: LayeredExportMode; swapMode?: 'ams' | 'pause'; slots?: number; paintFilaments?: 'library' | 'palette' | 'exact'; printer: string }) => void;
}

function numberField(label: string, value: number, min: number, max: number, step: number, hint: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'flex flex-col gap-1 text-[11px] text-zinc-400';
  row.title = hint;
  row.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.className = 'w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-blue-500';
  row.appendChild(input);
  return { row, input };
}

function selectField(label: string, options: Array<[string, string]>, value: string, hint: string): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('label');
  row.className = 'flex flex-col gap-1 text-[11px] text-zinc-400';
  row.title = hint;
  row.textContent = label;
  const select = document.createElement('select');
  select.className = 'w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-blue-500';
  for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; select.appendChild(o); }
  select.value = value;
  row.appendChild(select);
  return { row, select };
}

function readNum(input: HTMLInputElement, fallback: number): number {
  const v = Number(input.value);
  return Number.isFinite(v) ? v : fallback;
}

export function openLayeredPrintModal(opts: LayeredPrintModalOptions): void {
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const shell = createModalShell({
    title: 'Layered print from photo',
    widthClass: 'max-w-lg sm:max-w-3xl',
    scrollable: true,
    onClose: () => { abort?.abort(); if (timer) clearInterval(timer); },
  });

  const intro = document.createElement('p');
  intro.className = 'text-[12px] text-zinc-400 leading-relaxed';
  intro.textContent = 'Turns a photo into a filament-layering print: thin translucent layers, with filament swaps at chosen heights, so a few colours blend into many shades. '
    + 'The solver picks the filaments, the swap layers, and each pixel\'s height.';
  shell.body.appendChild(intro);

  const fileRow = document.createElement('div');
  fileRow.className = 'flex items-center gap-2 flex-wrap';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  fileInput.setAttribute('data-testid', 'layered-print-file');
  const pickBtn = document.createElement('button');
  pickBtn.className = BUTTON_SECONDARY;
  pickBtn.textContent = 'Choose photo…';
  pickBtn.addEventListener('click', () => fileInput.click());
  const fileName = document.createElement('span');
  fileName.className = 'text-[12px] text-zinc-400 truncate';
  fileName.textContent = 'No photo chosen';
  fileRow.append(pickBtn, fileName, fileInput);
  shell.body.appendChild(fileRow);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-5 gap-2';
  const colors = numberField('Colours (max)', 8, 1, 16, 1, 'Maximum number of filaments. Swaps that barely change the result are dropped.');
  const width = numberField('Width (mm)', 120, 20, 400, 5, 'Printed width; depth follows the photo.');
  const height = numberField('Max height (mm)', 2.4, 0.6, 6, 0.08, 'Tallest point. More height gives each filament more shades (and prints longer).');
  const swap = selectField('Export as', [
    ['ams', 'Layer swaps (AMS)'],
    ['pause', 'Layer swaps (manual pauses)'],
    ['painted', 'Painted regions (AMS)'],
  ], 'ams', 'Layer swaps: the filament changes at chosen heights and thin translucent layers blend (AMS changes automatically; manual pauses for you to swap). Painted: each region prints in its own filament, coloured like the preview — needs an AMS, more filament changes, but colours don\'t depend on translucency.');
  const printer = selectField('Printer', BAMBU_PRINTERS.map((p) => [p.id, p.label]), DEFAULT_BAMBU_PRINTER, 'Bambu printer profile for the 3MF.');
  grid.append(colors.row, width.row, height.row, swap.row, printer.row);
  shell.body.appendChild(grid);

  // Painted-mode options (shown only for "Painted regions").
  const paintedRow = document.createElement('div');
  paintedRow.className = 'grid grid-cols-2 sm:grid-cols-5 gap-2 hidden';
  const slots = numberField('AMS slots', 8, 1, 16, 1, 'How many filaments the painted 3MF may use. The preview colours are reduced to this many.');
  const paintSource = selectField('Painted colours', [
    ['library', 'Nearest real filaments'],
    ['palette', 'My palette'],
    ['exact', 'Exact preview shades'],
  ], 'library', 'Snap the colours to filaments that exist (the built-in list, or your palette), or keep the exact preview shades (you would need filaments in those colours).');
  paintedRow.append(slots.row, paintSource.row);
  shell.body.appendChild(paintedRow);
  swap.select.addEventListener('change', () => paintedRow.classList.toggle('hidden', swap.select.value !== 'painted'));

  const status = document.createElement('p');
  status.className = 'text-[12px] text-zinc-400 min-h-[1.25rem]';
  status.setAttribute('data-testid', 'layered-print-status');
  shell.body.appendChild(status);

  const canvas = document.createElement('canvas');
  canvas.className = 'w-full rounded border border-zinc-700 bg-zinc-900 hidden';
  canvas.setAttribute('data-testid', 'layered-print-preview');
  canvas.setAttribute('aria-label', 'Photo (left) and predicted print (right)');
  shell.body.appendChild(canvas);

  const stack = document.createElement('div');
  stack.className = 'flex flex-col gap-1';
  stack.setAttribute('data-testid', 'layered-print-stack');
  shell.body.appendChild(stack);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = 'Close';
  cancelBtn.addEventListener('click', () => shell.close());
  const solveBtn = document.createElement('button');
  solveBtn.className = BUTTON_SECONDARY;
  solveBtn.textContent = 'Solve';
  const downloadBtn = document.createElement('button');
  downloadBtn.className = BUTTON_SECONDARY;
  downloadBtn.textContent = 'Download 3MF';
  const createBtn = document.createElement('button');
  createBtn.className = BUTTON_PRIMARY;
  createBtn.textContent = 'Open in editor';
  shell.footer.append(cancelBtn, solveBtn, downloadBtn, createBtn);

  let image: ImageData | null = null;
  let photoDataUrl = '';
  let name = 'layered-print';
  let result: LayeredPrintResult | null = null;

  function syncButtons(busy: boolean): void {
    solveBtn.disabled = busy || !image;
    downloadBtn.disabled = busy || !result;
    createBtn.disabled = busy || !result;
    for (const b of [solveBtn, downloadBtn, createBtn]) b.classList.toggle('opacity-50', b.disabled);
  }

  function drawResult(r: LayeredPrintResult): void {
    const W = r.gridWidth, H = r.gridHeight, gap = Math.max(4, Math.round(W / 60));
    canvas.width = W * 2 + gap; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.target), W, H), 0, 0);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.preview), W, H), W + gap, 0);
    canvas.classList.remove('hidden');

    stack.replaceChildren();
    const head = document.createElement('div');
    head.className = 'text-[11px] text-zinc-400';
    head.textContent = `${r.blocks.length} filaments · ${r.totalLayers} layers · ${r.totalHeightMm} mm tall · ${Math.round(r.widthMm)} × ${Math.round(r.depthMm)} mm · predicted ΔE ${r.meanDeltaE.toFixed(1)} · layer ${r.options.layerHeight} mm (first ${r.options.firstLayerHeight})`;
    stack.appendChild(head);
    r.blocks.forEach((b, k) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 text-[12px] text-zinc-200';
      const chip = document.createElement('span');
      chip.className = 'inline-block w-4 h-4 rounded border border-zinc-600 shrink-0';
      chip.style.background = b.filament.hex;
      const text = document.createElement('span');
      text.textContent = k === 0
        ? `Start: ${b.filament.name} (${b.filament.hex}, TD ${b.filament.td})`
        : `Layer ${r.swaps[k - 1].layer} (Z ${r.swaps[k - 1].z.toFixed(2)} mm): ${b.filament.name} (${b.filament.hex}, TD ${b.filament.td})`;
      row.append(chip, text);
      stack.appendChild(row);
    });
  }

  async function runSolve(): Promise<void> {
    if (!image) return;
    abort?.abort();
    abort = new AbortController();
    const mine = abort;
    result = null;
    syncButtons(true);
    const started = performance.now();
    const tick = () => { status.textContent = `Solving… ${((performance.now() - started) / 1000).toFixed(0)}s`; };
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 500);
    try {
      const r = await opts.solve(image, {
        numColors: Math.round(readNum(colors.input, 8)),
        widthMm: readNum(width.input, 120),
        maxHeightMm: readNum(height.input, 2.4),
      }, mine.signal);
      if (mine.signal.aborted) return;
      result = r;
      drawResult(r);
      status.textContent = 'Left: your photo. Right: the predicted print.';
    } catch (e) {
      if (mine.signal.aborted) return;
      status.textContent = `Solve failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (abort === mine) { if (timer) clearInterval(timer); timer = null; syncButtons(false); }
    }
  }

  async function load(src: Blob | string): Promise<void> {
    try {
      status.textContent = 'Loading photo…';
      const d = await opts.decode(src);
      image = d.image;
      photoDataUrl = d.dataUrl;
      if (src instanceof File) name = src.name.replace(/\.[^.]+$/, '') || name;
      fileName.textContent = src instanceof File ? src.name : 'Attached image';
      await runSolve();
    } catch (e) {
      status.textContent = `Could not read that image: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void load(f); });
  solveBtn.addEventListener('click', () => { void runSolve(); });
  downloadBtn.addEventListener('click', () => {
    if (!result) return;
    const v = swap.select.value;
    opts.onDownload(result, v === 'painted'
      ? { mode: 'painted', slots: Math.round(readNum(slots.input, 8)), paintFilaments: paintSource.select.value as 'library' | 'palette' | 'exact', printer: printer.select.value }
      : { mode: 'layer-swap', swapMode: v as 'ams' | 'pause', printer: printer.select.value });
  });
  createBtn.addEventListener('click', async () => {
    if (!result) return;
    syncButtons(true);
    status.textContent = 'Building the model…';
    try {
      await opts.onCreate(result, name, photoDataUrl);
      shell.close();
    } catch (e) {
      status.textContent = `Could not create the model: ${e instanceof Error ? e.message : String(e)}`;
      syncButtons(false);
    }
  });

  syncButtons(false);
  if (opts.initialFile) void load(opts.initialFile);
  else if (opts.initialSrc) void load(opts.initialSrc);
}
