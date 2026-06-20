// Attachments panel — list, attach, relabel, and remove session attachments.
// Attachments are durable project files (reference images, reference models,
// spec PDFs, notes…) pinned to the session — they survive an AI chat clear and
// are exported with the session. Each carries a `kind`
// (image|model|document|text|other) plus a free-form `label` caption with
// preset suggestions like Front/Right/Back/Left/Top/Perspective (mainly useful
// for reference photos). The label shows in the Gallery for image attachments.

import { getState, type SessionAttachment } from '../storage/sessionManager';
import { generateId, PRESET_LABELS } from '../storage/db';
import { normalizeAttachment, attachmentKindLabel } from '../storage/attachment';
import { getAttachments, sortImagesByPreset } from '../renderer/multiview';

const DATALIST_ID = 'image-label-presets';

export interface ImagesViewCallbacks {
  /** Persist the new attachment list. The view re-renders after this resolves. */
  onChange: (attachments: SessionAttachment[]) => Promise<void> | void;
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
    empty.textContent = 'Open a session to attach files.';
    containerEl.appendChild(empty);
    return;
  }

  containerEl.appendChild(createHeader());

  const items = sortImagesByPreset(getAttachments());

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center flex-1 text-zinc-500 text-sm mt-8';
    empty.textContent = 'No attachments yet. Click "Attach…" to add a reference image, model, or document.';
    containerEl.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid gap-3 mt-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

  for (const item of items) {
    grid.appendChild(createImageTile(item, items));
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
  titleText.textContent = 'Attachments';
  title.appendChild(titleText);

  const desc = document.createElement('div');
  desc.className = 'text-xs text-zinc-500 leading-relaxed mt-0.5';
  desc.textContent = 'Reference files pinned to this session — photos to match, reference models, spec sheets, notes. They stay with the session (an AI chat clear won\'t remove them) and the assistant can read them back. Each has a label; presets like "Front" order reference photos in the Gallery.';
  title.appendChild(desc);

  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.id = 'btn-attach-image';
  addBtn.className = 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  addBtn.textContent = '+ Attach…';
  addBtn.addEventListener('click', () => showAttachImageModal(getAttachments(), persistAndRefresh));
  header.appendChild(addBtn);

  return header;
}

/** Emoji icon for a non-image attachment kind, shown on the file-card tile. */
function kindIcon(kind: SessionAttachment['kind']): string {
  switch (kind) {
    case 'model': return '\u{1F9CA}';      // ice cube — stands in for a 3D model
    case 'document': return '\u{1F4C4}';    // page
    case 'text': return '\u{1F4DD}';        // memo
    default: return '\u{1F4CE}';            // paperclip
  }
}

function createImageTile(item: SessionAttachment, allImages: SessionAttachment[]): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'bg-zinc-800 rounded-lg overflow-hidden flex flex-col relative';

  // Kind badge (top-right) for quick scanning, esp. with mixed attachment types.
  const badge = document.createElement('div');
  badge.className = 'absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 text-zinc-200 pointer-events-none';
  badge.textContent = attachmentKindLabel(item.kind);
  tile.appendChild(badge);

  if (item.kind === 'image') {
    // Thumbnail
    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden cursor-pointer';
    thumbContainer.title = 'Click to enlarge';

    const img = document.createElement('img');
    img.className = 'w-full h-full object-contain';
    applyImageSrc(img, item.src);
    thumbContainer.appendChild(img);
    thumbContainer.addEventListener('click', () => showLightbox(item.src, item.label || ''));
    tile.appendChild(thumbContainer);
  } else {
    // Non-image: a file card with a type icon + media type.
    const card = document.createElement('div');
    card.className = 'aspect-square bg-zinc-900 flex flex-col items-center justify-center gap-1 text-zinc-400';
    const icon = document.createElement('div');
    icon.className = 'text-4xl';
    icon.textContent = kindIcon(item.kind);
    card.appendChild(icon);
    const mt = document.createElement('div');
    mt.className = 'text-[10px] text-zinc-500 px-2 text-center break-all';
    mt.textContent = item.mediaType || attachmentKindLabel(item.kind);
    card.appendChild(mt);
    tile.appendChild(card);
  }

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
      // Preserve kind/mediaType/addedAt/source; only the label changes.
      const updated: SessionAttachment = { ...x, label: next };
      if (!next) delete updated.label;
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

async function persistAndRefresh(next: SessionAttachment[]): Promise<void> {
  await cb.onChange(next);
  refreshImages();
}

// === Attach modal (file upload + URL paste) ===

export function showAttachImageModal(
  current: SessionAttachment[],
  onSave: (next: SessionAttachment[]) => Promise<void> | void,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4';

  const title = document.createElement('h2');
  title.className = 'text-base font-semibold text-zinc-100 mb-2';
  title.textContent = 'Attach a file';

  const explanation = document.createElement('p');
  explanation.className = 'text-sm text-zinc-400 mb-4 leading-relaxed';
  explanation.textContent = 'Pin a reference file to this session — a photo to match, a reference model, a spec sheet, or notes. The type is detected automatically. Each item is auto-labeled from its filename or URL; rename it from the tile after attaching.';

  // File upload section
  const fileSection = document.createElement('div');
  fileSection.className = 'mb-4 p-3 rounded border border-zinc-700 bg-zinc-900/50';

  const fileLabel = document.createElement('div');
  fileLabel.className = 'text-xs font-semibold text-zinc-300 mb-1';
  fileLabel.textContent = 'Upload from your computer';

  const fileHint = document.createElement('div');
  fileHint.className = 'text-xs text-zinc-500 mb-2 leading-relaxed';
  fileHint.textContent = 'Select one or more files (images, STL/STEP/3MF models, PDFs, text). For reference photos, filenames containing front/right/back/left/top/perspective auto-set the matching preset label.';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.className = 'hidden';
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    const additions: SessionAttachment[] = [];
    for (const file of files) {
      const name = file.name.toLowerCase();
      const dataUrl = await readFileAsDataURL(file);
      const att = normalizeAttachment(
        { src: dataUrl, label: file.name, mediaType: file.type || undefined, addedAt: Date.now(), source: 'user' },
        generateId(),
      );
      // For reference photos, snap the label to a matching preset angle.
      if (att.kind === 'image') {
        const matched = PRESET_LABELS.find(p => name.includes(p.toLowerCase()));
        att.label = matched ?? 'Perspective';
      }
      additions.push(att);
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
      const item = normalizeAttachment(
        { src: dataUrl, label: matched ?? 'Perspective', kind: 'image', addedAt: Date.now(), source: 'user' },
        generateId(),
      );
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
  img.className = 'max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl';
  applyImageSrc(img, src);
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

/** True for an inline `data:` image (the form the attach flow always stores —
 *  both file uploads and pasted URLs are fetched and inlined to `data:`). */
function isInlineImageSrc(src: string): boolean {
  return src.startsWith('data:');
}

/** Point an <img> at a stored image source — but only auto-load inline `data:`
 *  URLs. A remote `http(s)` `src` only reaches here via an imported session
 *  payload; auto-loading it would fire an off-origin network request (an
 *  IP/tracking leak) just from viewing the session. Instead we show a
 *  click-to-load placeholder so the network request is the user's choice. */
function applyImageSrc(img: HTMLImageElement, src: string): void {
  if (isInlineImageSrc(src)) {
    img.src = src;
    return;
  }
  const load = (e?: Event) => {
    e?.stopPropagation();
    img.src = src;
    img.removeEventListener('click', load);
    img.removeAttribute('title');
    img.classList.remove('cursor-pointer');
  };
  // Defer the network request behind an explicit click on the image.
  img.alt = 'Remote image — click to load';
  img.title = 'Remote image — click to load';
  img.classList.add('cursor-pointer');
  img.addEventListener('click', load);
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
