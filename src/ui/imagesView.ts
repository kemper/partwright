// Images panel — list, attach, relabel, and remove session images.
// Each image has a single `label` field (a free-form caption with preset
// suggestions like Front/Right/Back/Left/Top/Perspective). The label is
// what shows in the Gallery; presets just make common values one click
// away rather than always typing.

import { getState, type AttachedImage } from '../storage/sessionManager';
import { generateId, PRESET_LABELS } from '../storage/db';
import { getImages, sortImagesByPreset } from '../renderer/multiview';

const DATALIST_ID = 'image-label-presets';

export interface ImagesViewCallbacks {
  /** Persist the new images list. The view re-renders after this resolves. */
  onChange: (images: AttachedImage[]) => Promise<void> | void;
}

let containerEl: HTMLElement | null = null;
let cb: ImagesViewCallbacks;

export function createImagesView(container: HTMLElement, callbacks: ImagesViewCallbacks): void {
  containerEl = container;
  cb = callbacks;

  // Single shared datalist for all label inputs in the app — created once.
  if (!document.getElementById(DATALIST_ID)) {
    const datalist = document.createElement('datalist');
    datalist.id = DATALIST_ID;
    for (const preset of PRESET_LABELS) {
      const opt = document.createElement('option');
      opt.value = preset;
      datalist.appendChild(opt);
    }
    document.body.appendChild(datalist);
  }

  window.addEventListener('session-changed', () => {
    if (containerEl && !containerEl.classList.contains('hidden')) refreshImages();
  });
  window.addEventListener('images-changed', () => {
    if (containerEl && !containerEl.classList.contains('hidden')) refreshImages();
  });
}

export function refreshImages(): void {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const state = getState();
  if (!state.session) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center flex-1 text-zinc-500 text-sm';
    empty.textContent = 'Open a session to attach images.';
    containerEl.appendChild(empty);
    return;
  }

  containerEl.appendChild(createHeader());

  const images = sortImagesByPreset(getImages());

  if (images.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center flex-1 text-zinc-500 text-sm mt-8';
    empty.textContent = 'No images yet. Click "Attach image…" to add one.';
    containerEl.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid gap-3 mt-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

  for (const item of images) {
    grid.appendChild(createImageTile(item, images));
  }

  containerEl.appendChild(grid);
}

function createHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'flex items-center gap-3 shrink-0';

  const title = document.createElement('div');
  title.className = 'flex-1';

  const titleText = document.createElement('div');
  titleText.className = 'text-sm font-semibold text-zinc-200';
  titleText.textContent = 'Reference images';
  title.appendChild(titleText);

  const desc = document.createElement('div');
  desc.className = 'text-xs text-zinc-500 leading-relaxed mt-0.5';
  desc.textContent = 'Photos or renderings the model should match. Each image has a label — pick a preset like "Front" or type your own caption — that shows in the Gallery and orders the image strip.';
  title.appendChild(desc);

  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.id = 'btn-attach-image';
  addBtn.className = 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  addBtn.textContent = '+ Attach image…';
  addBtn.addEventListener('click', () => showAttachImageModal(getImages(), persistAndRefresh));
  header.appendChild(addBtn);

  return header;
}

function createImageTile(item: AttachedImage, allImages: AttachedImage[]): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'bg-zinc-800 rounded-lg overflow-hidden flex flex-col';

  // Thumbnail
  const thumbContainer = document.createElement('div');
  thumbContainer.className = 'aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden cursor-pointer';
  thumbContainer.title = 'Click to enlarge';

  const img = document.createElement('img');
  img.src = item.src;
  img.className = 'w-full h-full object-contain';
  thumbContainer.appendChild(img);
  thumbContainer.addEventListener('click', () => showLightbox(item.src, item.label || ''));
  tile.appendChild(thumbContainer);

  // Footer: label input (with preset suggestions) and remove button
  const footer = document.createElement('div');
  footer.className = 'px-3 py-2 flex items-center gap-2';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Add a label (or pick a preset)';
  labelInput.value = item.label ?? '';
  labelInput.setAttribute('list', DATALIST_ID);
  labelInput.className = 'flex-1 bg-zinc-900 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-700 outline-none focus:border-blue-500 placeholder-zinc-600';
  const commitLabel = async () => {
    const next = labelInput.value.trim();
    const current = item.label ?? '';
    if (next === current) return;
    const nextList = allImages.map(x => {
      if (x.id !== item.id) return x;
      const updated: AttachedImage = { id: x.id, src: x.src };
      if (next) updated.label = next;
      return updated;
    });
    await persistAndRefresh(nextList);
  };
  labelInput.addEventListener('blur', commitLabel);
  // Datalist selection fires `change`; pick that up too in case the user
  // clicks a preset without ever typing.
  labelInput.addEventListener('change', commitLabel);
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') labelInput.blur();
    if (e.key === 'Escape') {
      labelInput.value = item.label ?? '';
      labelInput.blur();
    }
  });
  footer.appendChild(labelInput);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'shrink-0 text-xs text-zinc-500 hover:text-red-400 transition-colors px-1';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove this image';
  removeBtn.addEventListener('click', async () => {
    const next = allImages.filter(x => x.id !== item.id);
    await persistAndRefresh(next);
  });
  footer.appendChild(removeBtn);

  tile.appendChild(footer);
  return tile;
}

async function persistAndRefresh(next: AttachedImage[]): Promise<void> {
  await cb.onChange(next);
  refreshImages();
}

// === Attach modal (file upload + URL paste) ===

export function showAttachImageModal(
  current: AttachedImage[],
  onSave: (next: AttachedImage[]) => Promise<void> | void,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4';

  const title = document.createElement('h2');
  title.className = 'text-base font-semibold text-zinc-100 mb-2';
  title.textContent = 'Attach an image';

  const explanation = document.createElement('p');
  explanation.className = 'text-sm text-zinc-400 mb-4 leading-relaxed';
  explanation.textContent = 'Add a photo or rendering you want your model to match. Each image is auto-labeled from its filename or URL — rename it from the tile after attaching. The label appears in the Gallery and orders the image strip.';

  // File upload section
  const fileSection = document.createElement('div');
  fileSection.className = 'mb-4 p-3 rounded border border-zinc-700 bg-zinc-900/50';

  const fileLabel = document.createElement('div');
  fileLabel.className = 'text-xs font-semibold text-zinc-300 mb-1';
  fileLabel.textContent = 'Upload from your computer';

  const fileHint = document.createElement('div');
  fileHint.className = 'text-xs text-zinc-500 mb-2 leading-relaxed';
  fileHint.textContent = 'Select one or more images. Filenames containing front/right/back/left/top/perspective auto-set the label to the matching preset; anything else uses "Perspective".';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.className = 'hidden';
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    const additions: AttachedImage[] = [];
    for (const file of files) {
      const name = file.name.toLowerCase();
      const dataUrl = await readFileAsDataURL(file);
      const matched = PRESET_LABELS.find(p => name.includes(p.toLowerCase()));
      additions.push({ id: generateId(), src: dataUrl, label: matched ?? 'Perspective' });
    }

    await onSave([...current, ...additions]);
    fileInput.value = '';
    backdrop.remove();
  });

  const fileBtn = document.createElement('button');
  fileBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  fileBtn.textContent = 'Choose files…';
  fileBtn.addEventListener('click', () => fileInput.click());

  fileSection.appendChild(fileLabel);
  fileSection.appendChild(fileHint);
  fileSection.appendChild(fileInput);
  fileSection.appendChild(fileBtn);

  // URL section
  const urlSection = document.createElement('div');
  urlSection.className = 'mb-4 p-3 rounded border border-zinc-700 bg-zinc-900/50';

  const urlLabel = document.createElement('div');
  urlLabel.className = 'text-xs font-semibold text-zinc-300 mb-1';
  urlLabel.textContent = 'Paste an image URL';

  const urlHint = document.createElement('div');
  urlHint.className = 'text-xs text-zinc-500 mb-2 leading-relaxed';
  urlHint.textContent = 'URLs containing front/right/back/left/top/perspective auto-set the label to the matching preset; anything else uses "Perspective". The host must serve permissive CORS headers — if the request is blocked, download the file and use Upload above.';

  const urlRow = document.createElement('div');
  urlRow.className = 'flex gap-2 items-stretch';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://example.com/photo.jpg';
  urlInput.className = 'flex-1 bg-zinc-800 text-zinc-200 font-mono text-xs px-2 py-1.5 rounded border border-zinc-600 outline-none focus:border-blue-500';

  const urlBtn = document.createElement('button');
  urlBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  urlBtn.textContent = 'Load URL';

  const urlError = document.createElement('div');
  urlError.className = 'text-xs text-red-400 mt-2 hidden leading-relaxed';

  urlBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    urlError.classList.add('hidden');
    urlBtn.disabled = true;
    const original = urlBtn.textContent;
    urlBtn.textContent = 'Loading…';
    try {
      const dataUrl = await fetchImageAsDataURL(url);
      const matched = PRESET_LABELS.find(p => url.toLowerCase().includes(p.toLowerCase()));
      const item: AttachedImage = { id: generateId(), src: dataUrl, label: matched ?? 'Perspective' };
      await onSave([...current, item]);
      backdrop.remove();
    } catch (err) {
      urlError.textContent = `Could not load image: ${(err as Error).message}. The host may block cross-origin requests — try downloading and uploading instead.`;
      urlError.classList.remove('hidden');
      urlBtn.disabled = false;
      urlBtn.textContent = original;
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !urlBtn.disabled) urlBtn.click();
  });

  urlRow.appendChild(urlInput);
  urlRow.appendChild(urlBtn);

  urlSection.appendChild(urlLabel);
  urlSection.appendChild(urlHint);
  urlSection.appendChild(urlRow);
  urlSection.appendChild(urlError);

  // Footer
  const btnRow = document.createElement('div');
  btnRow.className = 'flex justify-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => backdrop.remove());

  btnRow.appendChild(cancelBtn);

  modal.appendChild(title);
  modal.appendChild(explanation);
  modal.appendChild(fileSection);
  modal.appendChild(urlSection);
  modal.appendChild(btnRow);
  backdrop.appendChild(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
  urlInput.focus();
}

function showLightbox(src: string, label: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const container = document.createElement('div');
  container.className = 'relative max-w-[90vw] max-h-[90vh] flex flex-col items-center';

  const img = document.createElement('img');
  img.src = src;
  img.className = 'max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl';
  container.appendChild(img);

  if (label) {
    const caption = document.createElement('div');
    caption.className = 'text-sm text-zinc-300 font-mono mt-2';
    caption.textContent = label;
    container.appendChild(caption);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'absolute -top-3 -right-3 w-8 h-8 rounded-full bg-zinc-700 text-zinc-300 hover:bg-zinc-600 flex items-center justify-center text-lg';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => overlay.remove());
  container.appendChild(closeBtn);

  overlay.appendChild(container);
  document.body.appendChild(overlay);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

async function fetchImageAsDataURL(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) URLs are supported');
  }

  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`expected an image, got ${contentType || 'unknown content-type'}`);
  }
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
