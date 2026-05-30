// "Import from URL…" modal. Accepts EITHER a Partwright share link (decoded
// locally, no network) OR an http(s) URL to a remote file (fetched and routed
// through the existing data-import paths). Built on the shared modalShell so
// Escape, click-outside, and listener cleanup match the other dialogs.
//
// The modal is intentionally dumb about *how* the import happens — it parses
// the input (via the pure `parseImportUrlInput` helper), shows inline
// validation, and hands the parsed result to the caller's `onSubmit`. The
// caller (main.ts) owns the share decode, the size-capped fetch, and the
// routing into handleImportFile / the session-import path.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { parseImportUrlInput, type ImportUrlParse } from '../import/urlImport';

export interface ImportUrlModalCallbacks {
  /** Perform the import for a validated input. Throw (or reject) with a
   *  human-readable message to surface it inline; the modal stays open so the
   *  user can correct the URL. Resolve to close the modal. */
  onSubmit: (parsed: Extract<ImportUrlParse, { kind: 'share' | 'remote' }>) => Promise<void>;
}

export function showImportUrlModal(callbacks: ImportUrlModalCallbacks): void {
  const shell = createModalShell({
    title: 'Import from URL',
    maxWidth: 'lg',
    onClose: () => {
      document.removeEventListener('keydown', onKey);
    },
  });

  const intro = document.createElement('p');
  intro.className = 'text-[12px] text-zinc-400 leading-relaxed';
  intro.textContent =
    'Paste a Partwright share link, or an http(s) link to a file ' +
    '(.json / .partwright.json, .stl, .step / .stp, .svg, .vox, or an image).';
  shell.body.appendChild(intro);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'url';
  input.placeholder = 'https://example.com/part.partwright.json  or  #share=…';
  input.className =
    'w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 ' +
    'placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';
  shell.body.appendChild(input);

  // Inline status line — validation errors, fetch errors, and progress.
  const status = document.createElement('p');
  status.className = 'text-[12px] leading-snug min-h-[1.25rem]';
  shell.body.appendChild(status);

  function setStatus(message: string, tone: 'error' | 'info' | 'none' = 'none'): void {
    status.textContent = message;
    status.className =
      'text-[12px] leading-snug min-h-[1.25rem] ' +
      (tone === 'error' ? 'text-red-400' : tone === 'info' ? 'text-zinc-400' : 'text-transparent');
  }

  const note = document.createElement('p');
  note.className = 'rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-500 leading-snug';
  note.textContent =
    'Remote files are fetched directly in your browser (no server), capped at 25 MB with a 15s timeout. ' +
    'Importing a session runs its code to rebuild previews — only import from sources you trust.';
  shell.body.appendChild(note);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => shell.close());
  shell.footer.appendChild(cancelBtn);

  const importBtn = document.createElement('button');
  importBtn.className = BUTTON_PRIMARY;
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => { void submit(); });
  shell.footer.appendChild(importBtn);

  let busy = false;
  async function submit(): Promise<void> {
    if (busy) return;
    const parsed = parseImportUrlInput(input.value);
    if (parsed.kind === 'invalid') {
      setStatus(parsed.reason, 'error');
      input.focus();
      return;
    }

    busy = true;
    importBtn.disabled = true;
    cancelBtn.disabled = true;
    input.disabled = true;
    importBtn.textContent = parsed.kind === 'share' ? 'Decoding…' : 'Fetching…';
    setStatus(parsed.kind === 'share' ? 'Decoding share link…' : 'Fetching file…', 'info');

    try {
      await callbacks.onSubmit(parsed);
      shell.close();
    } catch (e) {
      // Re-enable for a retry and surface the message inline.
      busy = false;
      importBtn.disabled = false;
      cancelBtn.disabled = false;
      input.disabled = false;
      importBtn.textContent = 'Import';
      setStatus((e as Error).message || 'Import failed.', 'error');
      input.focus();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !busy) { e.preventDefault(); void submit(); }
  }
  document.addEventListener('keydown', onKey);

  input.focus();
}
