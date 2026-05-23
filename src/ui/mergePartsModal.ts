// Modal for merging another part into the current one. The user picks the
// source part and what should happen to it afterwards (remove it, keep it, or
// leave both originals and produce a new combined part). The combine itself is
// done by the caller — this dialog only collects the choice.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { escapeHtml } from './htmlUtils';

export type MergeMode = 'remove' | 'keep' | 'new';

export interface MergePartsOptions {
  currentPartName: string;
  otherParts: { id: string; name: string }[];
}

export interface MergeChoice {
  sourcePartId: string;
  mode: MergeMode;
}

export function showMergePartsModal(opts: MergePartsOptions): Promise<MergeChoice | null> {
  return new Promise((resolve) => {
    let result: MergeChoice | null = null;
    const shell = createModalShell({
      title: 'Merge parts',
      onClose: () => resolve(result),
    });

    const intro = document.createElement('p');
    intro.className = 'text-[11px] text-zinc-400 leading-relaxed';
    intro.innerHTML = `Combine another part's geometry into <span class="text-zinc-200 font-medium">${escapeHtml(opts.currentPartName)}</span>. Both parts must be manifold (no render-only meshes).`;
    shell.body.appendChild(intro);

    // Source part picker.
    const srcLabel = document.createElement('label');
    srcLabel.className = 'text-xs text-zinc-300 font-medium';
    srcLabel.textContent = 'Merge in';
    shell.body.appendChild(srcLabel);

    const select = document.createElement('select');
    select.className = 'w-full bg-zinc-900 text-zinc-100 text-sm rounded border border-zinc-700 px-2 py-1.5 outline-none focus:border-blue-500';
    for (const p of opts.otherParts) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    shell.body.appendChild(select);

    // Mode radios.
    const modes: { mode: MergeMode; title: string; desc: string }[] = [
      { mode: 'remove', title: 'Merge and remove the other part', desc: 'Its geometry is added here, then the source part (and its history) is deleted.' },
      { mode: 'keep', title: 'Merge and keep the other part', desc: 'Its geometry is copied here; the source part stays as-is.' },
      { mode: 'new', title: 'Create a new combined part', desc: 'Both originals are left untouched and a new part holds the combination.' },
    ];

    const modeWrap = document.createElement('div');
    modeWrap.className = 'flex flex-col gap-1 mt-1';
    let selectedMode: MergeMode = 'remove';
    for (const m of modes) {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-2.5 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'merge-mode';
      radio.value = m.mode;
      radio.checked = m.mode === selectedMode;
      radio.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer';
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
    mergeBtn.addEventListener('click', () => {
      if (!select.value) return;
      result = { sourcePartId: select.value, mode: selectedMode };
      shell.close();
    });
    shell.footer.appendChild(mergeBtn);
  });
}
