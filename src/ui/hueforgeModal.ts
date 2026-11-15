// "HueForge print from photo" dialog — the non-AI front end to the HueForge
// solver. Pick a photo, set the colour count / size / height, solve (in a
// Worker), compare photo vs predicted print side by side with the filament
// stack + swap layers, then download the layer-swap 3MF or open the result as
// a session. main.ts owns the solve/commit/download callbacks; the same
// operations are on window.partwright (createHueforge / exportHueforge3MF).

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_CANCEL } from './styleConstants';
import { BAMBU_PRINTERS, DEFAULT_BAMBU_PRINTER } from '../export/threemfProject';
import type { HueforgeOptions, HueforgeResult, RgbaImage } from '../relief/hueforge/solver';
import type { HueforgeSwapMode } from '../relief/hueforge/export3mf';

export interface HueforgeModalOptions {
  /** Image URL (data: / blob: / http) to preload. */
  initialSrc?: string;
  solve: (image: RgbaImage, options: Partial<HueforgeOptions>, signal: AbortSignal) => Promise<HueforgeResult>;
  onCreate: (result: HueforgeResult, name: string) => Promise<void>;
  onDownload: (result: HueforgeResult, swapMode: HueforgeSwapMode, printer: string) => void;
}

/** Longest side the photo is decoded at — the solver's grid is far coarser. */
const MAX_DECODE_PX = 1600;

async function decodeToImageData(src: Blob | string): Promise<{ image: ImageData; name: string }> {
  let bitmap: ImageBitmap;
  let name = 'hueforge';
  if (typeof src === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    bitmap = await createImageBitmap(img);
  } else {
    bitmap = await createImageBitmap(src);
    if (src instanceof File) name = src.name.replace(/\.[^.]+$/, '') || name;
  }
  const scale = Math.min(1, MAX_DECODE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(2, Math.round(bitmap.width * scale)), h = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { image: ctx.getImageData(0, 0, w, h), name };
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

export function openHueforgeModal(opts: HueforgeModalOptions): void {
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const shell = createModalShell({
    title: 'HueForge print from photo',
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
  fileInput.setAttribute('data-testid', 'hueforge-file');
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
  const swap = selectField('Swaps', [['ams', 'AMS (automatic)'], ['pause', 'Manual (pauses)']], 'ams', 'AMS: the 3MF changes filament automatically (one AMS slot per filament). Manual: the printer pauses at each swap.');
  const printer = selectField('Printer', BAMBU_PRINTERS.map((p) => [p.id, p.label]), DEFAULT_BAMBU_PRINTER, 'Bambu printer profile for the 3MF.');
  grid.append(colors.row, width.row, height.row, swap.row, printer.row);
  shell.body.appendChild(grid);

  const status = document.createElement('p');
  status.className = 'text-[12px] text-zinc-400 min-h-[1.25rem]';
  status.setAttribute('data-testid', 'hueforge-status');
  shell.body.appendChild(status);

  const canvas = document.createElement('canvas');
  canvas.className = 'w-full rounded border border-zinc-700 bg-zinc-900 hidden';
  canvas.setAttribute('data-testid', 'hueforge-preview');
  canvas.setAttribute('aria-label', 'Photo (left) and predicted print (right)');
  shell.body.appendChild(canvas);

  const stack = document.createElement('div');
  stack.className = 'flex flex-col gap-1';
  stack.setAttribute('data-testid', 'hueforge-stack');
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
  let name = 'hueforge';
  let result: HueforgeResult | null = null;

  function syncButtons(busy: boolean): void {
    solveBtn.disabled = busy || !image;
    downloadBtn.disabled = busy || !result;
    createBtn.disabled = busy || !result;
    for (const b of [solveBtn, downloadBtn, createBtn]) b.classList.toggle('opacity-50', b.disabled);
  }

  function drawResult(r: HueforgeResult): void {
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
      const d = await decodeToImageData(src);
      image = d.image;
      name = d.name;
      fileName.textContent = src instanceof File ? src.name : 'Attached image';
      await runSolve();
    } catch (e) {
      status.textContent = `Could not read that image: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void load(f); });
  solveBtn.addEventListener('click', () => { void runSolve(); });
  downloadBtn.addEventListener('click', () => { if (result) opts.onDownload(result, swap.select.value as HueforgeSwapMode, printer.select.value); });
  createBtn.addEventListener('click', async () => {
    if (!result) return;
    syncButtons(true);
    status.textContent = 'Building the model…';
    try {
      await opts.onCreate(result, name);
      shell.close();
    } catch (e) {
      status.textContent = `Could not create the model: ${e instanceof Error ? e.message : String(e)}`;
      syncButtons(false);
    }
  });

  syncButtons(false);
  if (opts.initialSrc) void load(opts.initialSrc);
}
