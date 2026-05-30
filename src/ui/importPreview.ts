// Modal that shows a summary of a `.partwright.json` payload before committing
// it to IndexedDB. Built on the shared modalShell so Escape, click-outside,
// and listener cleanup behave identically to the other AI / export dialogs.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { escapeHtml } from './htmlUtils';
import { languageBadge } from './languageBadge';
import { summarizeSessionImport, type SessionImportSummary } from './importSummary';

// The pure summary logic lives in the DOM-free importSummary module so it can
// be unit-tested without pulling in modalShell/document. Re-exported here so
// existing importers (main.ts) keep a single import site for the feature.
export { summarizeSessionImport };
export type { SessionImportSummary };

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

/** Where a confirmed session import should land. `'cancel'` ⇒ dismissed. */
export type ImportDestination = 'new-session' | 'merge' | 'cancel';

export interface ImportPreviewOptions {
  /** When set, offers a "Merge into current session" destination alongside the
   *  default "Open as new session". The name is shown so the user knows what
   *  they'd be merging into. Omit (or leave undefined) when no session is open. */
  mergeTargetName?: string;
}

/**
 * Show a preview modal for a session import. Resolves with the chosen
 * destination — `'new-session'` (today's default), `'merge'` (only offered when
 * `mergeTargetName` is set), or `'cancel'` when dismissed.
 */
export function showImportPreview(
  filename: string,
  summary: SessionImportSummary,
  opts: ImportPreviewOptions = {},
): Promise<ImportDestination> {
  const canMerge = !!opts.mergeTargetName;
  return new Promise((resolve) => {
    let result: ImportDestination = 'cancel';
    // Default destination when merging is on offer: add the imported parts to
    // the current project. Importing as a new part is the common intent and
    // never clobbers existing work, so it's the pre-selected choice. (When no
    // session is open, `canMerge` is false and a new session is the only path.)
    let destination: 'new-session' | 'merge' = canMerge ? 'merge' : 'new-session';
    // Declared up front so updateNote() (which toggles its label) can close
    // over it before the footer wiring runs.
    const importBtn = document.createElement('button');
    const shell = createModalShell({
      title: 'Import session?',
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        resolve(result);
      },
    });

    const schema = document.createElement('p');
    schema.className = 'text-[10px] uppercase tracking-wide text-zinc-400';
    schema.textContent = `schema ${summary.schemaVersion}`;
    shell.body.appendChild(schema);

    const file = document.createElement('p');
    file.className = 'text-[11px] text-zinc-500 truncate';
    file.title = filename;
    file.textContent = filename;
    shell.body.appendChild(file);

    const sessionName = document.createElement('p');
    sessionName.className = 'text-zinc-200 text-sm';
    sessionName.innerHTML = `Session: <span class="font-medium">${escapeHtml(summary.sessionName)}</span>`;
    shell.body.appendChild(sessionName);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-300';
    function addRow(label: string, value: string) {
      const k = document.createElement('div');
      k.className = 'text-zinc-500';
      k.textContent = label;
      const v = document.createElement('div');
      v.className = 'text-zinc-200 truncate';
      v.textContent = value;
      v.title = value;
      grid.appendChild(k);
      grid.appendChild(v);
    }
    addRow('Versions', String(summary.versionCount));
    addRow(
      summary.languages.length > 1 ? 'Languages' : 'Language',
      summary.languages.map((l) => languageBadge(l).label).join(', '),
    );
    addRow('Notes', String(summary.noteCount));
    addRow('Annotations', String(summary.annotationCount));
    addRow('Reference images', summary.referenceSides.length ? summary.referenceSides.join(', ') : 'none');
    addRow('Last updated', formatTimestamp(summary.updatedAt));
    shell.body.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'text-[11px] text-zinc-500 leading-relaxed';
    shell.body.appendChild(note);

    // Destination chooser — only when a session is open to merge into. The
    // radios update both the live `destination` value and the helper note so
    // the consequence of each choice stays visible.
    if (canMerge) {
      const fieldset = document.createElement('div');
      fieldset.className = 'flex flex-col gap-1.5';

      const makeChoice = (value: 'new-session' | 'merge', label: string, hint: string): void => {
        const row = document.createElement('label');
        row.className = 'flex items-start gap-2 cursor-pointer text-sm text-zinc-200';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'import-destination';
        radio.value = value;
        radio.className = 'mt-0.5 shrink-0';
        radio.checked = value === destination;
        radio.addEventListener('change', () => {
          if (radio.checked) { destination = value; updateNote(); }
        });
        const text = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = label;
        const sub = document.createElement('div');
        sub.className = 'text-[11px] text-zinc-500 leading-snug';
        sub.textContent = hint;
        text.appendChild(title);
        text.appendChild(sub);
        row.appendChild(radio);
        row.appendChild(text);
        fieldset.appendChild(row);
      };

      // Order: the default (add as new part(s)) is listed first so it reads as
      // the recommended choice.
      makeChoice(
        'merge',
        'Add as new part(s) to current project',
        `Adds the imported parts to "${opts.mergeTargetName}" — nothing is replaced.`,
      );
      makeChoice(
        'new-session',
        'Open as new session',
        'Imports into a brand-new session. Your current session is kept.',
      );
      shell.body.appendChild(fieldset);
    }

    function updateNote(): void {
      if (canMerge && destination === 'merge') {
        note.textContent = `Adds the imported parts to "${opts.mergeTargetName}" as new part(s). Existing parts are untouched.`;
      } else {
        note.textContent = 'Imports as a new session — your current session is kept.';
      }
      importBtn.textContent = canMerge && destination === 'merge' ? 'Add parts' : 'Import';
    }

    // Code-execution warning. Importing a session runs each version's code in
    // your browser (to regenerate thumbnails), so a malicious file could
    // execute arbitrary JavaScript. Only confirm imports from sources you
    // trust. (The window.partwright.importSessionData console API bypasses
    // this modal — it's the programmatic path for agents/e2e.)
    const warn = document.createElement('p');
    warn.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-200 leading-snug';
    warn.innerHTML = '<strong>Heads up:</strong> importing runs each version’s code in your browser to rebuild previews. Only import sessions from sources you trust.';
    shell.body.appendChild(warn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = 'cancel'; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    importBtn.className = BUTTON_PRIMARY;
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', confirmImport);
    shell.footer.appendChild(importBtn);

    function confirmImport(): void {
      result = canMerge ? destination : 'new-session';
      shell.close();
    }

    // Now that the button exists, sync its label + the helper note to the
    // initial destination (and reflect any later radio changes).
    updateNote();

    // Modal shell handles Escape; we add an extra Enter-to-confirm shortcut
    // so the keyboard flow matches the previous standalone implementation.
    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); confirmImport(); }
    }
    document.addEventListener('keydown', onEnter);

    importBtn.focus();
  });
}
