// Modal that lets the user choose what to embed in a `.partwright.json`
// session export. Defaults match the historical behavior — everything
// session-bound is on, thumbnails off (importer regenerates from code).

import type { ExportOptions } from '../storage/sessionManager';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

interface OptionDef {
  key: keyof ExportOptions;
  label: string;
  description: string;
  defaultValue: boolean;
}

const OPTIONS: OptionDef[] = [
  {
    key: 'includeThumbnails',
    label: 'Thumbnail',
    description: 'Embeds the version preview image. Required for catalog entries; otherwise the importer regenerates it from code.',
    defaultValue: false,
  },
  {
    key: 'includeAnnotations',
    label: 'Annotations',
    description: 'Freehand strokes and pinned text labels drawn on the model.',
    defaultValue: true,
  },
  {
    key: 'includeNotes',
    label: 'Notes',
    description: 'Session-level design log entries (decisions, requirements, measurements).',
    defaultValue: true,
  },
  {
    key: 'includeColorRegions',
    label: 'Color regions',
    description: 'Per-face color metadata (used for multi-color 3MF / OBJ exports).',
    defaultValue: true,
  },
];

/**
 * Show the export options modal. Resolves with the selected options when the
 * user confirms, or null if they cancel / dismiss.
 */
export function showExportOptionsDialog(): Promise<ExportOptions | null> {
  return new Promise((resolve) => {
    let result: ExportOptions | null = null;
    const shell = createModalShell({
      title: 'Export session',
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        resolve(result);
      },
    });

    const sub = document.createElement('p');
    sub.className = 'text-[11px] text-zinc-400 leading-relaxed';
    sub.textContent = 'Choose what to include in the .partwright.json file.';
    shell.body.appendChild(sub);

    const checkboxes = new Map<keyof ExportOptions, HTMLInputElement>();

    for (const opt of OPTIONS) {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-2.5 py-1.5 cursor-pointer hover:bg-zinc-700/40 rounded px-2 -mx-2';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = opt.defaultValue;
      input.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer';
      checkboxes.set(opt.key, input);

      const text = document.createElement('div');
      text.className = 'flex-1 min-w-0';

      const labelEl = document.createElement('div');
      labelEl.className = 'text-xs text-zinc-200 font-medium';
      labelEl.textContent = opt.label;

      const descEl = document.createElement('div');
      descEl.className = 'text-[10px] text-zinc-500 leading-snug';
      descEl.textContent = opt.description;

      text.appendChild(labelEl);
      text.appendChild(descEl);

      row.appendChild(input);
      row.appendChild(text);
      shell.body.appendChild(row);
    }

    function confirm() {
      const opts: ExportOptions = {};
      for (const [key, input] of checkboxes) opts[key] = input.checked;
      result = opts;
      shell.close();
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', confirm);
    shell.footer.appendChild(exportBtn);

    // Modal shell handles Escape; we add Enter-to-confirm so the keyboard
    // flow matches the previous standalone implementation.
    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    }
    document.addEventListener('keydown', onEnter);

    exportBtn.focus();
  });
}
