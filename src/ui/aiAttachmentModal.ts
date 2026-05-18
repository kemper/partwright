// Attach-image picker. Replaces the bare file <input> behind the 📎 button
// with a modal that (a) warns when the active model can't see images and
// (b) shows the most recently attached images as one-click re-attach chips.

import { createModalShell } from './modalShell';
import { loadSettings } from '../ai/settings';
import { resolveLocalModel } from '../ai/local';
import { fileToImageSource } from '../ai/images';
import {
  attachmentToImageSource,
  deleteAttachment,
  listRecentAttachments,
  type RecentAttachment,
} from '../ai/attachments';
import type { ImageSource } from '../ai/types';

export interface AttachmentModalOptions {
  /** Invoked when the user picks one or more attachments (recent or new). */
  onAttach: (images: ImageSource[]) => void;
}

export function showAttachmentModal(opts: AttachmentModalOptions): void {
  const shell = createModalShell({ title: 'Attach image', maxWidth: 'lg', scrollable: true });

  // === Vision-support warning ===
  // Only shows when the user is on a local model that can't see images.
  // Anthropic's Claude 4.x family is all multimodal, so we never warn there.
  const settings = loadSettings();
  if (settings.toggles.provider === 'local' && settings.toggles.localModel) {
    try {
      const info = resolveLocalModel(settings.toggles.localModel);
      if (!info.supportsVision) {
        const warn = document.createElement('div');
        warn.className = 'px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-xs text-amber-200 leading-snug';
        const name = document.createElement('span');
        name.className = 'font-semibold';
        name.textContent = info.label;
        warn.appendChild(name);
        warn.appendChild(document.createTextNode(' can’t see images. Attachments will be silently dropped from the request. Switch to Anthropic in the toggle strip if you need the model to look at this image.'));
        shell.body.appendChild(warn);
      }
    } catch {
      // Unknown / removed model id — fall through; the rest of the picker
      // still works fine.
    }
  }

  // === Upload from disk ===
  const uploadRow = document.createElement('div');
  uploadRow.className = 'flex items-center gap-2';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.className = 'hidden';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  uploadBtn.textContent = 'Choose file…';
  uploadBtn.addEventListener('click', () => fileInput.click());

  const uploadHint = document.createElement('span');
  uploadHint.className = 'text-xs text-zinc-400';
  uploadHint.textContent = 'PNG, JPEG, GIF, or WebP.';

  uploadRow.appendChild(uploadBtn);
  uploadRow.appendChild(fileInput);
  uploadRow.appendChild(uploadHint);
  shell.body.appendChild(uploadRow);

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const picked: ImageSource[] = [];
    for (const file of Array.from(fileInput.files)) {
      const img = await fileToImageSource(file);
      if (img) picked.push(img);
    }
    fileInput.value = '';
    if (picked.length > 0) {
      shell.close();
      opts.onAttach(picked);
    }
  });

  // === Recent attachments ===
  const recentHeader = document.createElement('h3');
  recentHeader.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-2';
  recentHeader.textContent = 'Recent';
  shell.body.appendChild(recentHeader);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-4 gap-2';
  shell.body.appendChild(grid);

  void renderRecent(grid, shell.close, opts.onAttach);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', shell.close);
  shell.footer.appendChild(cancelBtn);
}

async function renderRecent(
  grid: HTMLElement,
  close: () => void,
  onAttach: (images: ImageSource[]) => void,
): Promise<void> {
  const recent = await listRecentAttachments();
  grid.replaceChildren();
  if (recent.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'col-span-4 text-xs text-zinc-500 italic';
    empty.textContent = 'No recent attachments yet. Files you attach will appear here.';
    grid.appendChild(empty);
    return;
  }
  for (const att of recent) {
    grid.appendChild(makeRecentTile(att, close, onAttach, () => { void renderRecent(grid, close, onAttach); }));
  }
}

function makeRecentTile(
  att: RecentAttachment,
  close: () => void,
  onAttach: (images: ImageSource[]) => void,
  onDelete: () => void,
): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'relative group rounded border border-zinc-700 overflow-hidden bg-zinc-900 hover:border-blue-500 cursor-pointer aspect-square';
  tile.title = `${att.label} — ${formatBytes(att.sizeBytes)}\nClick to attach`;
  tile.addEventListener('click', () => {
    close();
    onAttach([attachmentToImageSource(att)]);
  });

  const img = document.createElement('img');
  img.src = `data:${att.mediaType};base64,${att.data}`;
  img.className = 'w-full h-full object-cover';
  img.alt = att.label;
  tile.appendChild(img);

  // Filename overlay along the bottom — truncated; full name in tooltip.
  const caption = document.createElement('div');
  caption.className = 'absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-black/70 text-white text-[10px] leading-tight truncate';
  caption.textContent = att.label;
  tile.appendChild(caption);

  // Delete (X) shown on hover.
  const del = document.createElement('button');
  del.className = 'absolute top-0.5 right-0.5 w-5 h-5 rounded bg-black/70 text-white text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-red-600';
  del.textContent = '✕';
  del.title = `Remove ${att.label} from recents`;
  del.addEventListener('click', async e => {
    e.stopPropagation();
    await deleteAttachment(att.id);
    onDelete();
  });
  tile.appendChild(del);

  return tile;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
