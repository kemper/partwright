// Parts overview — a contact-sheet of every part in the active session.
//
// Built entirely from each part's saved latest-version thumbnail (the same
// Blobs the part-list rail shows), so opening it costs a handful of IndexedDB
// reads and zero geometry rebuilds — instant even for a 30-part kit. Parts
// that have never been run in this browser (no saved thumbnail yet) show a
// placeholder; they are deliberately NOT built here, since a background
// rebuild of every part is exactly the slow path this view avoids.

import { createModalShell } from './modalShell';
import { getState } from '../storage/sessionManager';
import { getLatestVersion } from '../storage/db';

/**
 * Open the overview modal. `onSelectPart` is invoked (after the modal closes)
 * when the user clicks a tile — callers pass the same handler the part-list
 * rail uses so tile-click behaves exactly like clicking the part row.
 * Returns false (and opens nothing) when there is no session or no parts.
 */
export function openPartsOverview(
  onSelectPart: (id: string) => void | Promise<void>,
): boolean {
  const state = getState();
  if (!state.session || state.parts.length === 0) return false;

  // Object URLs created for tile images; revoked when the modal closes. The
  // `closed` flag covers thumbnails that resolve AFTER a fast close (Escape
  // before a 37-part kit finishes loading) — those never enter `urls`, so
  // they must not be created at all once the modal is gone.
  const urls: string[] = [];
  let closed = false;
  const shell = createModalShell({
    title: `All parts (${state.parts.length})`,
    widthClass: 'max-w-lg sm:max-w-3xl lg:max-w-5xl',
    scrollable: true,
    onClose: () => {
      closed = true;
      for (const u of urls) URL.revokeObjectURL(u);
    },
  });

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2';
  shell.body.appendChild(grid);

  for (const part of state.parts) {
    const isCurrent = part.id === state.currentPart?.id;
    const tile = document.createElement('button');
    tile.dataset.overviewTile = part.id;
    tile.className =
      'flex flex-col rounded-lg border text-left overflow-hidden transition-colors ' +
      (isCurrent
        ? 'border-blue-500/70 bg-zinc-800'
        : 'border-zinc-700/70 bg-zinc-800/60 hover:bg-zinc-700/60 hover:border-zinc-600');
    tile.title = `Open part "${part.name}"`;

    const thumb = document.createElement('div');
    thumb.className = 'aspect-square w-full bg-zinc-900 flex items-center justify-center';
    const placeholder = document.createElement('span');
    placeholder.className = 'text-[10px] text-zinc-600 italic px-2 text-center';
    placeholder.textContent = 'not rendered yet — open to preview';
    thumb.appendChild(placeholder);
    tile.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'px-2 py-1 text-[11px] truncate ' + (isCurrent ? 'text-blue-300' : 'text-zinc-300');
    name.textContent = part.name;
    tile.appendChild(name);

    tile.addEventListener('click', () => {
      shell.close();
      void onSelectPart(part.id);
    });
    grid.appendChild(tile);

    // Fill the thumbnail asynchronously from the part's latest saved version.
    void getLatestVersion(part.id).then((v) => {
      if (closed || !v?.thumbnail) return;
      const url = URL.createObjectURL(v.thumbnail);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.className = 'w-full h-full object-contain';
      thumb.textContent = '';
      thumb.appendChild(img);
    });
  }

  const hint = document.createElement('p');
  hint.className = 'text-[11px] text-zinc-500 mt-3';
  hint.textContent =
    'Previews are each part’s saved thumbnail — nothing is rebuilt to show this view. Click a tile to open that part.';
  shell.body.appendChild(hint);

  return true;
}
