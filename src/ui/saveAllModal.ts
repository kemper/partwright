// Multi-part save modal — shown when a save action (Cmd/Ctrl+S or the 💾 Save
// button) fires while two or more parts in the session have unsaved changes.
// Lists every unsaved part in left-panel order, each pre-checked, with the
// current part called out, and lets the user save just the current part or any
// subset. Returns the user's choice; the caller (main.ts) does the saving.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

/** A filled secondary action button, sized to match {@link BUTTON_PRIMARY}.
 *  Used for "Save current part only" so it reads as a real action alongside the
 *  primary "Save selected", not as a cancel link. */
const BUTTON_SECONDARY =
  'px-4 py-1.5 rounded-lg text-sm font-medium bg-zinc-700 text-zinc-100 hover:bg-zinc-600 transition-colors';

export interface UnsavedPartRow {
  id: string;
  name: string;
  /** The part currently loaded in the editor — called out in the list. */
  isCurrent: boolean;
  /** `'empty'` = a never-saved part still on the starter ("no changes yet");
   *  `'unsaved'` = has real unsaved work. Drives the per-row status note. */
  status: 'empty' | 'unsaved';
}

export type SaveAllChoice =
  | { action: 'cancel' }
  | { action: 'current' }
  | { action: 'selected'; partIds: string[] };

/** Open the multi-part save modal. `parts` must already be in the left-panel
 *  display order. Resolves with the user's choice (cancel / save current only /
 *  save the checked subset). */
export function showSaveAllModal(parts: UnsavedPartRow[]): Promise<SaveAllChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: SaveAllChoice) => {
      if (settled) return;
      settled = true;
      resolve(choice);
      shell.close();
    };

    const shell = createModalShell({
      title: 'Save unsaved parts',
      maxWidth: 'md',
      scrollable: true,
      // Escape / click-outside / ✕ all count as cancel.
      onClose: () => { if (!settled) { settled = true; resolve({ action: 'cancel' }); } },
    });

    const intro = document.createElement('p');
    intro.className = 'text-zinc-300';
    intro.textContent =
      `${parts.length} parts have unsaved changes. Choose which to save — all are selected by default.`;
    shell.body.appendChild(intro);

    const listEl = document.createElement('div');
    listEl.className = 'flex flex-col gap-0.5 max-h-64 overflow-auto -mx-1';
    shell.body.appendChild(listEl);

    const checkboxes = new Map<string, HTMLInputElement>();
    const currentId = parts.find(p => p.isCurrent)?.id ?? null;

    for (const part of parts) {
      const row = document.createElement('label');
      row.className =
        'flex items-center gap-2.5 py-1.5 px-2 mx-1 rounded cursor-pointer hover:bg-zinc-700/40';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.className = 'w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
      input.addEventListener('change', updateSelectedButton);
      checkboxes.set(part.id, input);
      row.appendChild(input);

      const name = document.createElement('span');
      name.className = 'text-zinc-100 truncate flex-1 min-w-0';
      name.textContent = part.name;
      row.appendChild(name);

      // "no changes yet" note for freshly-created parts the user hasn't edited.
      if (part.status === 'empty') {
        const note = document.createElement('span');
        note.className = 'shrink-0 text-[11px] italic text-zinc-500';
        note.textContent = 'no changes yet';
        row.appendChild(note);
      }

      if (part.isCurrent) {
        const badge = document.createElement('span');
        badge.className =
          'shrink-0 text-[10px] uppercase tracking-wide font-semibold text-blue-300 bg-blue-500/15 border border-blue-500/30 rounded px-1.5 py-0.5';
        badge.textContent = 'Current part';
        row.appendChild(badge);
      }

      listEl.appendChild(row);
    }

    // Footer: Cancel | Save current part only | Save selected (N)
    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish({ action: 'cancel' }));
    shell.footer.appendChild(cancelBtn);

    if (currentId) {
      const currentBtn = document.createElement('button');
      currentBtn.className = BUTTON_SECONDARY;
      currentBtn.textContent = 'Save current part only';
      currentBtn.addEventListener('click', () => finish({ action: 'current' }));
      shell.footer.appendChild(currentBtn);
    }

    const selectedBtn = document.createElement('button');
    selectedBtn.className = BUTTON_PRIMARY;
    shell.footer.appendChild(selectedBtn);
    selectedBtn.addEventListener('click', () => {
      const ids = parts.map(p => p.id).filter(id => checkboxes.get(id)?.checked);
      if (ids.length === 0) return;
      finish({ action: 'selected', partIds: ids });
    });

    function updateSelectedButton(): void {
      const count = parts.filter(p => checkboxes.get(p.id)?.checked).length;
      selectedBtn.textContent = count === parts.length ? 'Save all' : `Save selected (${count})`;
      selectedBtn.disabled = count === 0;
      selectedBtn.classList.toggle('opacity-50', count === 0);
      selectedBtn.classList.toggle('cursor-default', count === 0);
    }
    updateSelectedButton();

    // Focus the primary action so Enter saves all by default.
    requestAnimationFrame(() => selectedBtn.focus());
  });
}
