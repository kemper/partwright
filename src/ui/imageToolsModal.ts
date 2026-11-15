// "Image tools" panel (#1256 Stage A): pick an image attached to the session,
// then a tool that turns it into geometry (tile, silhouette, stepped relief,
// lithophane, layered filament print, voxel art). If the open object was made
// by a tool, offer to re-open that tool with its stored settings and re-apply
// it (a new version of the same object). main.ts owns attaching, the tool
// flows and the commits; the same operations are on window.partwright
// (applyImageTool / getImageToolOp / listImageTools).

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_CANCEL } from './styleConstants';
import { IMAGE_TOOLS, imageToolInfo, type ImageToolId, type ImageToolOp } from '../imageTools/descriptor';

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
  /** Launch `tool` on `image` — as a NEW object, or replacing the open one. */
  onChooseTool: (tool: ImageToolId, image: string, opts: { replace: boolean; params?: Record<string, unknown> }) => void;
}

export function openImageToolsModal(opts: ImageToolsModalOptions): void {
  const shell = createModalShell({ title: 'Image tools', widthClass: 'max-w-lg sm:max-w-2xl', scrollable: true });
  let images = opts.images.slice();
  let selected = opts.selectedImage ?? images[0]?.id ?? '';

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

  // ── image picker ──
  const imgHead = document.createElement('div');
  imgHead.className = 'text-[11px] uppercase tracking-wider text-zinc-500 font-semibold';
  imgHead.textContent = 'Image';
  shell.body.appendChild(imgHead);
  const strip = document.createElement('div');
  strip.className = 'flex gap-2 flex-wrap items-center';
  strip.setAttribute('data-testid', 'image-tools-images');
  shell.body.appendChild(strip);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  fileInput.setAttribute('data-testid', 'image-tools-file');

  function renderImages(): void {
    strip.replaceChildren();
    for (const im of images) {
      const b = document.createElement('button');
      const on = im.id === selected;
      b.className = `w-20 h-20 rounded-lg overflow-hidden border-2 ${on ? 'border-blue-500' : 'border-zinc-700 [@media(hover:hover)]:hover:border-zinc-500'}`;
      b.title = im.label ?? 'Attached image';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `Use image ${im.label ?? im.id}`);
      const img = document.createElement('img');
      img.src = im.src;
      img.alt = '';
      img.className = 'w-full h-full object-cover';
      b.appendChild(img);
      b.addEventListener('click', () => { selected = im.id; renderImages(); syncTools(); });
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
      selected = im.id;
      renderImages();
      syncTools();
    } catch (e) {
      status.textContent = `Could not attach that image: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  // ── tools ──
  const toolHead = document.createElement('div');
  toolHead.className = 'text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mt-1';
  toolHead.textContent = 'Make a new object with';
  shell.body.appendChild(toolHead);
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-2';
  grid.setAttribute('data-testid', 'image-tools-list');
  shell.body.appendChild(grid);
  const toolButtons: HTMLButtonElement[] = [];
  for (const t of IMAGE_TOOLS) {
    const b = document.createElement('button');
    b.className = 'text-left rounded-lg border border-zinc-700 bg-zinc-900/60 [@media(hover:hover)]:hover:border-blue-500 [@media(hover:hover)]:hover:bg-zinc-900 px-3 py-2 min-h-[44px] transition-colors disabled:opacity-40';
    const name = document.createElement('div');
    name.className = 'text-sm text-zinc-100 font-medium';
    name.textContent = t.label;
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-400 leading-snug mt-0.5';
    desc.textContent = t.description;
    b.append(name, desc);
    b.addEventListener('click', () => {
      if (!selected) return;
      shell.close();
      opts.onChooseTool(t.id, selected, { replace: false });
    });
    toolButtons.push(b);
    grid.appendChild(b);
  }

  const status = document.createElement('p');
  status.className = 'text-[12px] text-zinc-400 min-h-[1rem]';
  shell.body.appendChild(status);

  function syncTools(): void {
    for (const b of toolButtons) b.disabled = !selected;
    status.textContent = selected ? '' : 'Add an image first.';
  }

  const close = document.createElement('button');
  close.className = BUTTON_CANCEL;
  close.textContent = 'Close';
  close.addEventListener('click', () => shell.close());
  shell.footer.appendChild(close);

  renderImages();
  syncTools();
}
