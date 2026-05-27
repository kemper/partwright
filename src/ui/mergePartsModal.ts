// Modal shown when merging the multi-selected parts in the rail. It collects
// what should happen to the originals — keep them and add a new combined part,
// or replace them with a single combined part. The combine itself is done by
// the caller; this dialog only collects the choice. Built on the shared
// modalShell so Escape / click-outside / focus handling matches other dialogs.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { escapeHtml } from './htmlUtils';

export type MergeMode = 'new' | 'replace';

export interface MergePartsOptions {
  /** Names of the parts being merged (two or more). */
  partNames: string[];
}

export interface MergeChoice {
  mode: MergeMode;
}

export function showMergePartsModal(opts: MergePartsOptions): Promise<MergeChoice | null> {
  return new Promise((resolve) => {
    let result: MergeChoice | null = null;
    const shell = createModalShell({
      title: 'Merge parts',
      onClose: () => resolve(result),
    });

    const names = opts.partNames.map(n => `"${escapeHtml(n)}"`).join(', ');
    const intro = document.createElement('p');
    intro.className = 'text-[11px] text-zinc-400 leading-relaxed';
    intro.innerHTML = `Combine <span class="text-zinc-200 font-medium">${opts.partNames.length} parts</span> — ${names} — into one, composed as separate components. Render-only parts can't be combined.`;
    shell.body.appendChild(intro);

    const modes: { mode: MergeMode; title: string; desc: string }[] = [
      { mode: 'new', title: 'Combine into a new part', desc: 'Keeps the selected parts and adds a new part holding the combination.' },
      { mode: 'replace', title: 'Merge into one part', desc: 'Replaces the selected parts (and their history) with a single combined part.' },
    ];

    const modeWrap = document.createElement('div');
    modeWrap.className = 'flex flex-col gap-1 mt-1';
    let selectedMode: MergeMode = 'new';
    for (const m of modes) {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-2.5 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'merge-mode';
      radio.value = m.mode;
      radio.checked = m.mode === selectedMode;
      radio.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer';
      radio.dataset.mode = m.mode;
      radio.addEventListener('change', () => { if (radio.checked) selectedMode = m.mode; });
      const text = document.createElement('div');
      text.className = 'flex-1 min-w-0';
      const t = document.createElement('div');
      t.className = 'text-xs text-zinc-200 font-medium';
      t.textContent = m.title;
      const d = document.createElement('div');
      d.className = 'text-[10px] text-zinc-500 leading-snug';
      d.textContent = m.desc;
      text.appendChild(t);
      text.appendChild(d);
      row.appendChild(radio);
      row.appendChild(text);
      modeWrap.appendChild(row);
    }
    shell.body.appendChild(modeWrap);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const mergeBtn = document.createElement('button');
    mergeBtn.className = BUTTON_PRIMARY;
    mergeBtn.textContent = 'Merge';
    mergeBtn.dataset.action = 'merge';
    mergeBtn.addEventListener('click', () => {
      result = { mode: selectedMode };
      shell.close();
    });
    shell.footer.appendChild(mergeBtn);
  });
}
