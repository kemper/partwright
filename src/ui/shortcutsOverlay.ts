// In-app keyboard cheat sheet, opened with `?`. Renders the canonical shortcut
// list from shortcutDefs (the same source the help page uses) so the keys shown
// here can never drift from the keys that actually fire.

import { createModalShell } from './modalShell';
import { getShortcutDocs } from './shortcutDefs';

let isOpen = false;

export function isShortcutsOverlayOpen(): boolean {
  return isOpen;
}

export function openShortcutsOverlay(): void {
  if (isOpen) return;
  isOpen = true;
  const shell = createModalShell({
    title: 'Keyboard shortcuts',
    maxWidth: 'lg',
    scrollable: true,
    onClose: () => { isOpen = false; },
  });

  const tip = document.createElement('p');
  tip.className = 'text-xs text-zinc-400';
  tip.textContent = 'Tip: press the command palette key to search and run any action by name.';
  shell.body.appendChild(tip);

  const table = document.createElement('div');
  table.className = 'flex flex-col divide-y divide-zinc-700/70';
  for (const doc of getShortcutDocs()) {
    const row = document.createElement('div');
    row.className = 'flex items-start justify-between gap-4 py-2';

    const desc = document.createElement('span');
    desc.className = 'text-sm text-zinc-300';
    desc.textContent = doc.description;

    const kbd = document.createElement('kbd');
    kbd.className = 'shrink-0 text-xs text-zinc-200 bg-zinc-900/70 border border-zinc-700 rounded px-2 py-1 whitespace-nowrap';
    kbd.textContent = doc.keys;

    row.appendChild(desc);
    row.appendChild(kbd);
    table.appendChild(row);
  }
  shell.body.appendChild(table);

  const footnote = document.createElement('p');
  footnote.className = 'text-xs text-zinc-500';
  footnote.textContent = 'Undo / redo defer to the editor or active tool depending on focus.';
  shell.body.appendChild(footnote);
}
