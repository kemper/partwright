// Part-selection modal for multi-part 3MF export. Lets the user pick which
// Session Parts to bundle into one 3MF (one part per build plate), with a
// thumbnail preview of each. The currently-viewed part is preselected; a
// Select-all / Select-none toggle handles assemblies with many parts.
//
// Resolves with the chosen part ids (in list order) when the user confirms, or
// null if they cancel / dismiss. Only the export caller decides what to do with
// the selection — this modal is pure UI.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

export interface ExportPartChoice {
  id: string;
  name: string;
  /** Pre-baked preview thumbnail (latest version's). May be null. */
  thumbnail: Blob | null;
}

/**
 * Show the multi-part 3MF part picker. `activePartId` is preselected. `bambu`
 * tailors the title/help text (per-plate Bambu project vs generic multi-object).
 * Returns the selected part ids, or null on cancel.
 */
export function showExportPartsModal(
  parts: ExportPartChoice[],
  activePartId: string | null,
  bambu = true,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    let result: string[] | null = null;
    // Track object URLs so we can revoke them on teardown (no GPU/blob leak).
    const objectUrls: string[] = [];

    const shell = createModalShell({
      title: bambu ? 'Export parts to 3MF (Bambu/Orca)' : 'Export parts to 3MF',
      scrollable: true,
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        for (const url of objectUrls) URL.revokeObjectURL(url);
        resolve(result);
      },
    });

    const sub = document.createElement('p');
    sub.className = 'text-[11px] text-zinc-400 leading-relaxed';
    sub.textContent = bambu
      ? 'Choose which parts to include. Each selected part is placed on its own build plate, and painted colours are bound to filaments for Bambu Studio / OrcaSlicer.'
      : 'Choose which parts to include. Each selected part is added as a separate object, arranged in a grid so they don’t overlap. Standard 3MF — opens in any slicer.';
    shell.body.appendChild(sub);

    // Header row with the count + select-all toggle.
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between mt-1';
    const heading = document.createElement('div');
    heading.className = 'text-xs text-zinc-200 font-medium';
    const toggleAll = document.createElement('button');
    toggleAll.type = 'button';
    toggleAll.className = 'text-[10px] text-blue-400 hover:text-blue-300';
    head.append(heading, toggleAll);
    shell.body.appendChild(head);

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 mt-1';
    shell.body.appendChild(list);

    const checks: HTMLInputElement[] = [];

    for (const part of parts) {
      const row = document.createElement('label');
      row.className = 'flex items-center gap-3 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = part.id === activePartId;
      cb.className = 'w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
      cb.dataset.id = part.id;
      checks.push(cb);

      // Thumbnail (or a placeholder square).
      const thumb = document.createElement('div');
      thumb.className = 'w-12 h-12 rounded bg-zinc-900 border border-zinc-700 shrink-0 overflow-hidden flex items-center justify-center';
      if (part.thumbnail) {
        const url = URL.createObjectURL(part.thumbnail);
        objectUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'w-full h-full object-contain';
        img.alt = `${part.name} preview`;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '—';
        thumb.classList.add('text-zinc-600', 'text-xs');
      }

      const meta = document.createElement('div');
      meta.className = 'flex-1 min-w-0';
      const nameEl = document.createElement('div');
      nameEl.className = 'text-xs text-zinc-200 font-medium truncate';
      nameEl.textContent = part.name;
      meta.appendChild(nameEl);
      if (part.id === activePartId) {
        const badge = document.createElement('div');
        badge.className = 'text-[10px] text-blue-400';
        badge.textContent = 'Currently viewing';
        meta.appendChild(badge);
      }

      row.append(cb, thumb, meta);
      list.appendChild(row);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    shell.footer.appendChild(exportBtn);

    function selectedIds(): string[] {
      return checks.filter(c => c.checked).map(c => c.dataset.id!).filter(Boolean);
    }

    function sync() {
      const n = selectedIds().length;
      heading.textContent = `Parts (${n} of ${parts.length} selected)`;
      exportBtn.textContent = n > 1 ? `Export ${n} parts` : 'Export';
      exportBtn.disabled = n === 0;
      exportBtn.classList.toggle('opacity-40', n === 0);
      exportBtn.classList.toggle('cursor-default', n === 0);
      toggleAll.textContent = checks.every(c => c.checked) ? 'Select none' : 'Select all';
    }

    function confirm() {
      const ids = selectedIds();
      if (ids.length === 0) return;
      result = ids;
      shell.close();
    }

    toggleAll.addEventListener('click', () => {
      const allChecked = checks.every(c => c.checked);
      for (const c of checks) c.checked = !allChecked;
      sync();
    });
    for (const c of checks) c.addEventListener('change', sync);
    exportBtn.addEventListener('click', confirm);

    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    }
    document.addEventListener('keydown', onEnter);

    sync();
    exportBtn.focus();
  });
}
