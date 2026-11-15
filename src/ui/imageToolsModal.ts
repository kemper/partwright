// "Image tools" panel (#1256 Stage A): pick an image attached to the session,
// optionally prep it (crop, tone, background), pick a tool that turns it into
// geometry (tile, silhouette, stepped relief, lithophane, layered filament
// print, voxel art), see a live preview of what the tool will make, then open
// the tool's own wizard. If the open object was made by a tool, offer to
// re-open that tool with its stored settings and re-apply it (a new version of
// the same object). main.ts owns attaching, prepping, the tool flows and the
// commits; the same operations are on window.partwright (applyImageTool /
// prepImage / getImageToolOp / listImageTools).

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_CANCEL } from './styleConstants';
import { createCropBox } from './cropBox';
import { createSliderEntry } from './sliderEntry';
import { getConfig } from '../config/appConfig';
import { IMAGE_TOOLS, imageToolInfo, type ImageToolId, type ImageToolOp } from '../imageTools/descriptor';
import { isNoopPrep, prepImagePixels, type ImagePrepOptions, type PixelImage } from '../imageTools/prep';
import { renderImageToolPreview } from '../imageTools/preview';

export interface ImageToolsImage {
  id: string;
  src: string;
  label?: string;
}

export interface ImageToolsModalOptions {
  /** Image attachments of the current session. */
  images: ImageToolsImage[];
  /** Pre-select this image (e.g. the one just imported). */
  selectedImage?: string;
  /** The open object's stored tool record, if it was made by an image tool. */
  currentOp: ImageToolOp | null;
  /** Attach a picked file to the session; resolves to the new attachment. */
  addImage: (file: File) => Promise<ImageToolsImage>;
  /** Save a prepped copy of `image` as a new attachment; resolves to it. */
  prepImage: (image: string, prep: ImagePrepOptions) => Promise<ImageToolsImage>;
  /** Launch `tool` on `image` — as a NEW object, or replacing the open one. */
  onChooseTool: (tool: ImageToolId, image: string, opts: { replace: boolean; params?: Record<string, unknown> }) => void;
}

/** Decode an image src into pixels, long side capped at `maxPx`. */
async function decodeForPreview(src: string, maxPx: number): Promise<PixelImage> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

/** Display size (CSS px, long side) of the preview raster — fits the preview column. */
const PREVIEW_DISPLAY_PX = 224;

type ToneKey = 'brightness' | 'contrast' | 'saturation' | 'levelsLow' | 'levelsHigh';
const PREP_DEFAULTS: Record<ToneKey, number> = { brightness: 0, contrast: 0, saturation: 0, levelsLow: 0, levelsHigh: 255 };

export function openImageToolsModal(opts: ImageToolsModalOptions): void {
  let closed = false;
  let previewTimer: number | undefined;
  const shell = createModalShell({
    title: 'Image tools', widthClass: 'max-w-lg sm:max-w-2xl', scrollable: true,
    // Stop async preview work once the dialog is gone.
    onClose: () => { closed = true; if (previewTimer !== undefined) window.clearTimeout(previewTimer); },
  });
  let images = opts.images.slice();
  let selected = opts.selectedImage ?? images[0]?.id ?? '';
  let tool: ImageToolId | null = opts.currentOp?.tool ?? 'tile';
  // Prep state for the selected image (reset when another image is picked).
  const prep: Record<ToneKey, number> & { crop: { left: number; top: number; right: number; bottom: number }; removeBackground: boolean } = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, ...PREP_DEFAULTS, removeBackground: false };

  const intro = document.createElement('p');
  intro.className = 'text-[12px] text-zinc-400 leading-relaxed';
  intro.textContent = 'Pick an image attached to this session, then a tool that turns it into a printable model. The tool\'s settings are saved with the object, so you can re-open and re-apply them later.';
  shell.body.appendChild(intro);

  // ── current object's tool (re-apply) ──
  if (opts.currentOp) {
    const op = opts.currentOp;
    const box = document.createElement('div');
    box.className = 'rounded-lg border border-blue-700/60 bg-blue-950/30 px-3 py-2 flex items-center gap-3 flex-wrap';
    box.setAttribute('data-testid', 'image-tools-current');
    const text = document.createElement('div');
    text.className = 'text-[12px] text-zinc-200 flex-1 min-w-[12rem]';
    text.textContent = `This object was made with ${imageToolInfo(op.tool).label}.`;
    const reopen = document.createElement('button');
    reopen.className = BUTTON_PRIMARY;
    reopen.textContent = 'Edit settings & re-apply';
    reopen.addEventListener('click', () => {
      shell.close();
      opts.onChooseTool(op.tool, op.image, { replace: true, params: op.params });
    });
    box.append(text, reopen);
    shell.body.appendChild(box);
  }

  const heading = (text: string): HTMLDivElement => {
    const h = document.createElement('div');
    h.className = 'text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mt-1';
    h.textContent = text;
    return h;
  };

  // ── image picker ──
  shell.body.appendChild(heading('Image'));
  const strip = document.createElement('div');
  strip.className = 'flex gap-2 flex-wrap items-center';
  strip.setAttribute('data-testid', 'image-tools-images');
  shell.body.appendChild(strip);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  fileInput.setAttribute('data-testid', 'image-tools-file');

  function selectImage(id: string): void {
    selected = id;
    resetPrep();
    renderImages();
    syncControls();
  }

  function renderImages(): void {
    strip.replaceChildren();
    for (const im of images) {
      const b = document.createElement('button');
      const on = im.id === selected;
      b.className = `w-20 h-20 rounded-lg overflow-hidden border-2 ${on ? 'border-blue-500' : 'border-zinc-700 hover:border-zinc-500'}`;
      b.title = im.label ?? 'Attached image';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `Use image ${im.label ?? im.id}`);
      const img = document.createElement('img');
      img.src = im.src;
      img.alt = '';
      img.className = 'w-full h-full object-cover';
      b.appendChild(img);
      b.addEventListener('click', () => selectImage(im.id));
      strip.appendChild(b);
    }
    const add = document.createElement('button');
    add.className = BUTTON_SECONDARY;
    add.textContent = images.length ? 'Add image…' : 'Choose image…';
    add.addEventListener('click', () => fileInput.click());
    strip.append(add, fileInput);
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const im = await opts.addImage(f);
      images = [...images, im];
      selectImage(im.id);
    } catch (e) {
      status.textContent = `Could not attach that image: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  // ── prep (crop, tone, background) ──
  const prepBox = document.createElement('details');
  prepBox.className = 'rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2';
  prepBox.setAttribute('data-testid', 'image-tools-prep');
  const prepSummary = document.createElement('summary');
  prepSummary.className = 'text-[12px] text-zinc-200 cursor-pointer select-none min-h-[28px] flex items-center';
  prepSummary.textContent = 'Prep image — crop, levels, background';
  prepBox.appendChild(prepSummary);
  const prepBody = document.createElement('div');
  prepBody.className = 'flex flex-col sm:flex-row gap-3 mt-2';
  prepBox.appendChild(prepBody);
  shell.body.appendChild(prepBox);

  let naturalAspect = 1;
  const cropBox = createCropBox({
    getCrop: () => prep.crop,
    getNaturalAspect: () => naturalAspect,
    onChange: () => schedulePreview(),
    widthPx: 180,
  });
  cropBox.img.addEventListener('load', () => {
    naturalAspect = cropBox.img.naturalWidth / Math.max(1, cropBox.img.naturalHeight);
  });
  prepBody.appendChild(cropBox.el);

  const sliders = document.createElement('div');
  sliders.className = 'flex flex-col gap-1.5 flex-1 min-w-0';
  prepBody.appendChild(sliders);
  const refreshers: Array<() => void> = [];
  function slider(label: string, key: ToneKey, min: number, max: number, step: number, integer = false): void {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-2 text-[11px] text-zinc-300';
    const name = document.createElement('span');
    name.className = 'w-20 shrink-0';
    name.textContent = label;
    const entry = createSliderEntry({
      label, min, max, step, value: prep[key], integer,
      onChange: (v) => { prep[key] = v; schedulePreview(); syncPrepButtons(); },
    });
    row.append(name, entry.range, entry.input);
    refreshers.push(() => entry.set(prep[key]));
    sliders.appendChild(row);
  }
  slider('Brightness', 'brightness', -1, 1, 0.05);
  slider('Contrast', 'contrast', -1, 1, 0.05);
  slider('Saturation', 'saturation', -1, 1, 0.05);
  slider('Black point', 'levelsLow', 0, 254, 1, true);
  slider('White point', 'levelsHigh', 1, 255, 1, true);
  const bgRow = document.createElement('label');
  bgRow.className = 'flex items-center gap-2 text-[11px] text-zinc-300 min-h-[28px] cursor-pointer';
  const bgBox = document.createElement('input');
  bgBox.type = 'checkbox';
  bgBox.className = 'accent-blue-500';
  bgBox.setAttribute('data-testid', 'image-tools-prep-bg');
  bgBox.addEventListener('change', () => { prep.removeBackground = bgBox.checked; schedulePreview(); syncPrepButtons(); });
  const bgText = document.createElement('span');
  bgText.textContent = 'Remove background (the colour around the edges)';
  bgRow.append(bgBox, bgText);
  sliders.appendChild(bgRow);
  const prepActions = document.createElement('div');
  prepActions.className = 'flex gap-2 flex-wrap items-center mt-1';
  const resetBtn = document.createElement('button');
  resetBtn.className = BUTTON_CANCEL;
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => { resetPrep(); schedulePreview(); });
  const saveBtn = document.createElement('button');
  saveBtn.className = BUTTON_SECONDARY;
  saveBtn.textContent = 'Save prepped copy';
  saveBtn.setAttribute('data-testid', 'image-tools-prep-save');
  saveBtn.addEventListener('click', () => { void savePrepped(); });
  const prepNote = document.createElement('span');
  prepNote.className = 'text-[11px] text-zinc-500';
  prepNote.textContent = 'Saved as a new attached image; the original stays.';
  prepActions.append(resetBtn, saveBtn, prepNote);
  sliders.appendChild(prepActions);

  function currentPrep(): ImagePrepOptions {
    return { crop: { ...prep.crop }, brightness: prep.brightness, contrast: prep.contrast, saturation: prep.saturation, levelsLow: prep.levelsLow, levelsHigh: Math.max(prep.levelsLow + 1, prep.levelsHigh), removeBackground: prep.removeBackground };
  }
  function resetPrep(): void {
    Object.assign(prep, PREP_DEFAULTS, { crop: { left: 0, top: 0, right: 1, bottom: 1 }, removeBackground: false });
    for (const r of refreshers) r();
    bgBox.checked = false;
    const im = images.find((i) => i.id === selected);
    if (im && cropBox.img.getAttribute('src') !== im.src) cropBox.img.src = im.src;
    cropBox.render();
    syncPrepButtons();
  }
  function syncPrepButtons(): void {
    const noop = isNoopPrep(currentPrep());
    saveBtn.disabled = noop || !selected;
    saveBtn.classList.toggle('opacity-50', saveBtn.disabled);
    resetBtn.disabled = noop;
  }

  /** Save the prep as a new attachment and select it. */
  async function savePrepped(): Promise<string | null> {
    if (!selected) return null;
    const p = currentPrep();
    if (isNoopPrep(p)) return selected;
    status.textContent = 'Saving the prepped copy…';
    try {
      const im = await opts.prepImage(selected, p);
      if (!images.some((i) => i.id === im.id)) images = [...images, im];
      selectImage(im.id);
      status.textContent = `Saved "${im.label ?? 'prepped image'}".`;
      return im.id;
    } catch (e) {
      status.textContent = `Could not prep the image: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }
  }

  // ── tools ──
  shell.body.appendChild(heading('Make a new object with'));
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 gap-2 flex-1 min-w-0';
  grid.setAttribute('data-testid', 'image-tools-list');
  // Tools on the left, the live preview beside them (stacked on phones).
  const toolRow = document.createElement('div');
  toolRow.className = 'flex flex-col sm:flex-row gap-3 items-stretch sm:items-start';
  toolRow.appendChild(grid);
  shell.body.appendChild(toolRow);
  const toolButtons = new Map<ImageToolId, HTMLButtonElement>();
  for (const t of IMAGE_TOOLS) {
    const b = document.createElement('button');
    b.className = 'text-left rounded-lg border px-3 py-2 min-h-[44px] transition-colors disabled:opacity-40';
    b.dataset.tool = t.id;
    const name = document.createElement('div');
    name.className = 'text-sm text-zinc-100 font-medium';
    name.textContent = t.label;
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-400 leading-snug mt-0.5';
    desc.textContent = t.description;
    b.append(name, desc);
    b.addEventListener('click', () => { tool = t.id; syncControls(); });
    // Double-click (or double-tap) opens straight away.
    b.addEventListener('dblclick', () => { tool = t.id; void openSelected(); });
    toolButtons.set(t.id, b);
    grid.appendChild(b);
  }

  // ── live preview ──
  const previewWrap = document.createElement('div');
  previewWrap.className = 'flex flex-col items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 sm:w-64 sm:shrink-0 sm:sticky sm:top-0';
  previewWrap.setAttribute('data-testid', 'image-tools-preview');
  const canvas = document.createElement('canvas');
  canvas.className = 'rounded border border-zinc-700 bg-zinc-900 max-w-full';
  canvas.style.imageRendering = 'pixelated';
  canvas.width = 1; canvas.height = 1;
  const caption = document.createElement('div');
  caption.className = 'text-[11px] text-zinc-400 font-mono text-center';
  caption.setAttribute('data-testid', 'image-tools-preview-caption');
  previewWrap.append(canvas, caption);
  const previewHead = document.createElement('div');
  previewHead.className = 'text-[11px] uppercase tracking-wider text-zinc-500 font-semibold self-start';
  previewHead.textContent = 'Preview';
  previewWrap.prepend(previewHead);
  toolRow.appendChild(previewWrap);

  const status = document.createElement('p');
  status.className = 'text-[12px] text-zinc-400 min-h-[1rem]';
  shell.body.appendChild(status);

  // Decoded pixels per attachment id (the preview re-renders often).
  const decoded = new Map<string, Promise<PixelImage>>();
  let previewSeq = 0;
  function schedulePreview(): void {
    if (closed) return;
    if (previewTimer !== undefined) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => { void renderPreview(); }, getConfig().ui.imageToolPreviewDebounceMs);
  }
  async function renderPreview(): Promise<void> {
    const seq = ++previewSeq;
    const im = images.find((i) => i.id === selected);
    if (!im || !tool) {
      canvas.width = 1; canvas.height = 1;
      canvas.style.width = '1px'; canvas.style.height = '1px';
      caption.textContent = im ? 'Pick a tool to preview it.' : 'Add an image to preview a tool.';
      return;
    }
    const maxPx = Math.max(16, getConfig().ui.imageToolPreviewMaxPx);
    try {
      let pending = decoded.get(im.id);
      if (!pending) { pending = decodeForPreview(im.src, maxPx * 2); decoded.set(im.id, pending); }
      const base = await pending;
      if (seq !== previewSeq || closed) return;
      const p = currentPrep();
      const src = isNoopPrep(p) ? base : prepImagePixels(base, p);
      const pv = renderImageToolPreview(tool, src, {}, maxPx);
      canvas.width = pv.width; canvas.height = pv.height;
      const scale = PREVIEW_DISPLAY_PX / Math.max(pv.width, pv.height);
      canvas.style.width = `${Math.round(pv.width * scale)}px`;
      canvas.style.height = `${Math.round(pv.height * scale)}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const data = ctx.createImageData(pv.width, pv.height);
        data.data.set(pv.rgba);
        ctx.putImageData(data, 0, 0);
      }
      caption.textContent = pv.caption;
    } catch (e) {
      decoded.delete(im.id);
      caption.textContent = `No preview: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── footer ──
  const close = document.createElement('button');
  close.className = BUTTON_CANCEL;
  close.textContent = 'Close';
  close.addEventListener('click', () => shell.close());
  const openBtn = document.createElement('button');
  openBtn.className = `${BUTTON_PRIMARY} truncate max-w-[13rem] sm:max-w-none`;
  openBtn.setAttribute('data-testid', 'image-tools-open');
  openBtn.addEventListener('click', () => { void openSelected(); });
  shell.footer.append(close, openBtn);

  async function openSelected(): Promise<void> {
    if (!selected || !tool) return;
    const t = tool;
    // An unsaved prep is saved first, so the tool reads the prepped pixels.
    const image = isNoopPrep(currentPrep()) ? selected : await savePrepped();
    if (!image) return;
    shell.close();
    opts.onChooseTool(t, image, { replace: false });
  }

  function syncControls(): void {
    for (const [id, b] of toolButtons) {
      const on = id === tool;
      b.disabled = !selected;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('border-blue-500', on);
      b.classList.toggle('bg-blue-950/40', on);
      b.classList.toggle('border-zinc-700', !on);
      b.classList.toggle('bg-zinc-900/60', !on);
    }
    openBtn.disabled = !selected || !tool;
    openBtn.classList.toggle('opacity-50', openBtn.disabled);
    openBtn.textContent = tool ? `Open ${imageToolInfo(tool).label}…` : 'Open…';
    prepBox.classList.toggle('hidden', !selected);
    status.textContent = selected ? '' : 'Add an image first.';
    syncPrepButtons();
    schedulePreview();
  }

  renderImages();
  resetPrep();
  syncControls();
}
