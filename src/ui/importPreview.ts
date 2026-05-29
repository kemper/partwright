// Modal that shows a summary of a `.partwright.json` payload before committing
// it to IndexedDB. Built on the shared modalShell so Escape, click-outside,
// and listener cleanup behave identically to the other AI / export dialogs.

import type { ExportedSession } from '../storage/sessionManager';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { escapeHtml } from './htmlUtils';

export interface SessionImportSummary {
  sessionName: string;
  schemaVersion: string;
  versionCount: number;
  noteCount: number;
  annotationCount: number;
  referenceSides: string[];
  language: string;
  createdAt: number | null;
  updatedAt: number | null;
}

/** Build a SessionImportSummary from a parsed .partwright.json payload. */
export function summarizeSessionImport(data: ExportedSession): SessionImportSummary {
  // Build a list of image labels for the import preview. Handle three shapes:
  //   - current: array of {id, src, label?}
  //   - pre-unification: array of {id, angle, src, label?} — fall back to angle
  //   - pre-array: object map {front: 'url', ...} — use the keys
  // Items with no label and no angle are listed as "(unlabeled)".
  const imgs = data.session.images ?? data.session.referenceImages ?? null;
  const referenceSides: string[] = [];
  if (Array.isArray(imgs)) {
    for (const item of imgs) {
      const it = item as { label?: string; angle?: string };
      const label = (it.label ?? '').trim() || (it.angle ? it.angle : '');
      referenceSides.push(label || '(unlabeled)');
    }
  } else if (imgs && typeof imgs === 'object') {
    for (const k of ['front', 'right', 'back', 'left', 'top', 'perspective'] as const) {
      if ((imgs as Record<string, unknown>)[k]) referenceSides.push(k);
    }
  }
  // Annotations live per-version since schema 1.3, but 1.2 files put them at
  // the top level. Sum across both locations so the preview is accurate
  // regardless of which schema the file was exported with. Versions can be
  // absent for chat/notes-only exports — fall back to an empty list.
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const perVersionAnnotations = versions.reduce(
    (sum, v) => sum + (v.annotations?.length ?? 0),
    0,
  );
  const topLevelAnnotations = data.annotations?.length ?? 0;
  return {
    sessionName: data.session.name || '(unnamed)',
    schemaVersion: data.partwright ?? data.mainifold ?? 'unknown',
    versionCount: versions.length,
    noteCount: data.notes?.length ?? 0,
    annotationCount: perVersionAnnotations + topLevelAnnotations,
    referenceSides,
    language: data.session.language ?? 'manifold-js',
    createdAt: data.session.created ?? null,
    updatedAt: data.session.updated ?? null,
  };
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

/**
 * Show a preview modal for a session import. Resolves true if the user
 * confirms, false if they cancel or dismiss.
 */
export function showImportPreview(filename: string, summary: SessionImportSummary): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
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
    addRow('Language', summary.language);
    addRow('Notes', String(summary.noteCount));
    addRow('Annotations', String(summary.annotationCount));
    addRow('Reference images', summary.referenceSides.length ? summary.referenceSides.join(', ') : 'none');
    addRow('Last updated', formatTimestamp(summary.updatedAt));
    shell.body.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'text-[11px] text-zinc-500 leading-relaxed';
    note.textContent = 'Imports as a new session — your current session is kept.';
    shell.body.appendChild(note);

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
    cancelBtn.addEventListener('click', () => { result = false; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const importBtn = document.createElement('button');
    importBtn.className = BUTTON_PRIMARY;
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => { result = true; shell.close(); });
    shell.footer.appendChild(importBtn);

    // Modal shell handles Escape; we add an extra Enter-to-confirm shortcut
    // so the keyboard flow matches the previous standalone implementation.
    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); result = true; shell.close(); }
    }
    document.addEventListener('keydown', onEnter);

    importBtn.focus();
  });
}
