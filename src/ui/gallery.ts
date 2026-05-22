// Gallery view — grid of version thumbnails for comparing iterations,
// plus a read-only strip of attached reference images at the top.

import { listCurrentVersions, loadVersion } from '../storage/sessionManager';
import { getImages, sortImagesByPreset, type AttachedImage } from '../renderer/multiview';
import { createVersionTile } from './versionTile';

let galleryEl: HTMLElement | null = null;
let onLoadCode: ((code: string) => void) | null = null;

export function createGalleryView(container: HTMLElement, loadCode: (code: string) => void): void {
  galleryEl = container;
  onLoadCode = loadCode;

  window.addEventListener('session-changed', () => {
    if (galleryEl && !galleryEl.classList.contains('hidden')) refreshGallery();
  });
  // Re-render when images are attached/removed/relabeled elsewhere.
  window.addEventListener('images-changed', () => {
    if (galleryEl && !galleryEl.classList.contains('hidden')) refreshGallery();
  });
}

export async function refreshGallery(): Promise<void> {
  if (!galleryEl) return;

  const versions = await listCurrentVersions();
  const images = getImages();
  galleryEl.innerHTML = '';

  if (images.length > 0) {
    galleryEl.appendChild(createImagesSection(images));
  }

  if (versions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center text-zinc-500 text-sm py-12';
    empty.textContent = 'No versions saved yet. Click "Save" to capture a version.';
    galleryEl.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid gap-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

  for (const version of versions) {
    grid.appendChild(createVersionTile(version, {
      onClick: async (v) => {
        const loaded = await loadVersion(v.index);
        if (loaded && onLoadCode) onLoadCode(loaded.code);
      },
    }));
  }

  galleryEl.appendChild(grid);
}

function createImagesSection(images: AttachedImage[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'mb-4 pb-4 border-b border-zinc-700';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 mb-2';

  const icon = document.createElement('span');
  icon.className = 'text-blue-400 text-sm';
  icon.textContent = '\u{1F5BC}';
  header.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'text-xs font-mono font-medium text-zinc-300';
  title.textContent = `Images (${images.length})`;
  header.appendChild(title);

  section.appendChild(header);

  const sorted = sortImagesByPreset(images);

  const row = document.createElement('div');
  row.className = 'flex gap-2 overflow-x-auto';

  for (const item of sorted) {
    const thumb = document.createElement('div');
    thumb.className = 'flex flex-col items-center shrink-0';

    const caption = (item.label ?? '').trim();
    const imgEl = document.createElement('img');
    imgEl.src = item.src;
    imgEl.className = 'w-24 h-24 object-contain rounded bg-zinc-800 border border-blue-500/30 cursor-pointer hover:border-blue-400 transition-colors';
    imgEl.title = caption ? `Click to enlarge: ${caption}` : 'Click to enlarge';
    imgEl.addEventListener('click', () => showLightbox(item.src, caption));
    thumb.appendChild(imgEl);

    // Caption only shows the user-provided label. Angle is system metadata
    // surfaced in the Images tab, not used as a fallback caption here — the
    // image content speaks for itself.
    if (caption) {
      const labelEl = document.createElement('div');
      labelEl.className = 'text-xs text-zinc-300 font-mono mt-0.5 max-w-24 truncate';
      labelEl.title = caption;
      labelEl.textContent = caption;
      thumb.appendChild(labelEl);
    }

    row.appendChild(thumb);
  }

  section.appendChild(row);
  return section;
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
