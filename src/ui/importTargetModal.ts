// Modal shown when importing a mesh (STL) while a session with real content is
// already open. Lets the user choose where the imported geometry should land:
// a new part in the current session (default), merged into the current part, or
// a brand-new session. Built on the shared modalShell so Escape / click-outside
// / focus handling matches the other dialogs.

import { createModalShell } from './modalShell';
import { BUTTON_CANCEL } from './styleConstants';
import { escapeHtml } from './htmlUtils';

export type ImportTarget = 'new-part' | 'current-part' | 'new-session';

export interface ImportTargetOptions {
  /** Display name of the file being imported. */
  filename: string;
  /** Name of the active part, or null when none is open. */
  currentPartName: string | null;
  /** Whether "Add to current part" is selectable. */
  canAddToCurrent: boolean;
  /** Shown under the disabled "Add to current part" option to explain why. */
  addDisabledReason?: string;
  /** Which option to highlight as the default and focus. Defaults to 'new-part'. */
  recommend?: ImportTarget;
  /** When true, the current part is an empty/starter part, so "Add to current
   *  part" really just makes the mesh the part's content (framed as such). */
  addReplacesStarter?: boolean;
}

interface Choice {
  target: ImportTarget;
  title: string;
  desc: string;
  recommended?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Show the import-target chooser. Resolves with the picked target, or null if
 * the user cancels / dismisses.
 */
export function showImportTargetModal(opts: ImportTargetOptions): Promise<ImportTarget | null> {
  return new Promise((resolve) => {
    let result: ImportTarget | null = null;
    const shell = createModalShell({
      title: 'Import mesh',
      onClose: () => resolve(result),
    });

    const intro = document.createElement('p');
    intro.className = 'text-[11px] text-zinc-400 leading-relaxed';
    intro.innerHTML = `Where should <span class="text-zinc-200 font-medium">${escapeHtml(opts.filename)}</span> go?`;
    shell.body.appendChild(intro);

    const recommend = opts.recommend ?? 'new-part';
    const partLabel = opts.currentPartName ? `"${opts.currentPartName}"` : 'the current part';
    const choices: Choice[] = [
      {
        target: 'new-part',
        title: 'New part',
        desc: 'Add it as a separate part in this session, with its own version history.',
      },
      {
        target: 'current-part',
        title: opts.addReplacesStarter ? `Use for current part — ${partLabel}` : `Add to current part — ${partLabel}`,
        desc: opts.addReplacesStarter
          ? 'Make this mesh the contents of the current (empty) part.'
          : 'Combine it with the geometry already in this part (composed as separate components).',
        disabled: !opts.canAddToCurrent,
        disabledReason: opts.addDisabledReason,
      },
      {
        target: 'new-session',
        title: 'New session',
        desc: 'Import into a brand-new session, leaving the current one untouched.',
      },
    ];
    for (const c of choices) c.recommended = c.target === recommend && !c.disabled;

    const pick = (target: ImportTarget) => { result = target; shell.close(); };

    let firstEnabled: HTMLButtonElement | null = null;
    let recommendedBtn: HTMLButtonElement | null = null;
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.target = c.target;
      btn.disabled = !!c.disabled;
      btn.className = [
        'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
        c.disabled
          ? 'border-zinc-800 bg-zinc-800/40 opacity-50 cursor-not-allowed'
          : 'border-zinc-700 hover:border-blue-500 hover:bg-blue-500/10 cursor-pointer',
      ].join(' ');

      const titleRow = document.createElement('div');
      titleRow.className = 'flex items-center gap-2';
      const title = document.createElement('span');
      title.className = 'text-sm text-zinc-100 font-medium';
      title.textContent = c.title;
      titleRow.appendChild(title);
      if (c.recommended) {
        const pill = document.createElement('span');
        pill.className = 'text-[9px] uppercase tracking-wide font-semibold text-blue-300 bg-blue-500/20 rounded px-1.5 py-0.5';
        pill.textContent = 'Default';
        titleRow.appendChild(pill);
      }
      btn.appendChild(titleRow);

      const desc = document.createElement('div');
      desc.className = 'text-[11px] text-zinc-400 leading-snug mt-0.5';
      desc.textContent = c.disabled && c.disabledReason ? c.disabledReason : c.desc;
      btn.appendChild(desc);

      if (!c.disabled) {
        btn.addEventListener('click', () => pick(c.target));
        if (!firstEnabled) firstEnabled = btn;
        if (c.recommended) recommendedBtn = btn;
      }
      shell.body.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    // Focus the recommended option (falling back to the first enabled one) so
    // Enter/Space confirms it immediately.
    requestAnimationFrame(() => (recommendedBtn ?? firstEnabled)?.focus());
  });
}
