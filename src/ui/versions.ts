// Versions tab — manage saved versions (rename, delete) with in-memory
// undo/redo. Reuses the Gallery's tile via the shared version tile, adding
// per-tile controls and an undo/redo toolbar. Deletions are permanent in
// storage but reversible until the page is refreshed — the undo/redo stacks
// live in memory only.

import {
  listCurrentVersions,
  deleteVersion,
  restoreVersion,
  renameVersion,
  getState,
  type Version,
} from '../storage/sessionManager';
import { createVersionTile, type VersionTileControl } from './versionTile';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';

export interface VersionsViewCallbacks {
  /** Load a version into the editor + viewport and switch to the interactive tab. */
  onOpenVersion: (version: Version) => void | Promise<void>;
  /** Reload the editor + viewport for the active version without switching tabs
   *  (used after deleting/undoing the active version). */
  onSyncEditor: (version: Version) => void | Promise<void>;
}

type VersionOp =
  | { kind: 'delete'; version: Version; wasCurrent: boolean }
  | { kind: 'rename'; versionId: string; oldLabel: string; newLabel: string };

let versionsEl: HTMLElement | null = null;
let cbs: VersionsViewCallbacks | null = null;
let undoStack: VersionOp[] = [];
let redoStack: VersionOp[] = [];
let lastSessionId: string | null = null;

export function createVersionsView(container: HTMLElement, callbacks: VersionsViewCallbacks): void {
  versionsEl = container;
  cbs = callbacks;
  lastSessionId = getState().session?.id ?? null;

  window.addEventListener('session-changed', () => {
    const id = getState().session?.id ?? null;
    if (id !== lastSessionId) {
      // Switched sessions — the undo history refers to the previous session's
      // versions, so drop it.
      undoStack = [];
      redoStack = [];
      lastSessionId = id;
    }
    if (versionsEl && !versionsEl.classList.contains('hidden')) void refreshVersions();
  });
}

export async function refreshVersions(): Promise<void> {
  if (!versionsEl) return;

  const versions = await listCurrentVersions();
  const currentId = getState().currentVersion?.id ?? null;

  versionsEl.innerHTML = '';
  versionsEl.appendChild(buildToolbar(versions.length));

  if (versions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center text-zinc-500 text-sm py-12';
    empty.textContent = 'No versions saved yet. Click "Save" to capture a version.';
    versionsEl.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid gap-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

  const canDelete = versions.length > 1;
  for (const version of versions) {
    const controls: VersionTileControl[] = [
      { label: '✎', title: 'Rename this version', onClick: (v) => void performRename(v) },
    ];
    if (canDelete) {
      controls.push({
        label: '🗑',
        title: 'Delete this version (undoable until you refresh)',
        danger: true,
        onClick: (v) => void performDelete(v),
      });
    }
    grid.appendChild(createVersionTile(version, {
      active: version.id === currentId,
      onClick: (v) => void cbs?.onOpenVersion(v),
      controls,
    }));
  }
  versionsEl.appendChild(grid);
}

function buildToolbar(versionCount: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'flex items-center gap-2 mb-4 pb-3 border-b border-zinc-700';

  const title = document.createElement('span');
  title.className = 'text-xs font-mono text-zinc-300';
  title.textContent = `Versions (${versionCount})`;
  bar.appendChild(title);

  const hint = document.createElement('span');
  hint.className = 'text-[10px] text-zinc-500 hidden sm:inline';
  hint.textContent = 'Hover a tile to rename or delete';
  bar.appendChild(hint);

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';
  bar.appendChild(spacer);

  bar.appendChild(makeStackButton('↶ Undo', undoStack, undo, 'Undo'));
  bar.appendChild(makeStackButton('↷ Redo', redoStack, redo, 'Redo'));

  return bar;
}

function makeStackButton(
  text: string,
  stack: VersionOp[],
  handler: () => void,
  verb: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  const enabled = stack.length > 0;
  btn.className = BUTTON_SMALL_SECONDARY + (enabled ? '' : ' opacity-40 cursor-default');
  btn.textContent = text;
  btn.disabled = !enabled;
  btn.title = enabled ? `${verb} ${describeOp(stack[stack.length - 1])}` : `Nothing to ${verb.toLowerCase()}`;
  btn.addEventListener('click', () => handler());
  return btn;
}

function describeOp(op: VersionOp): string {
  return op.kind === 'delete'
    ? `delete of "${op.version.label}"`
    : `rename "${op.oldLabel}" → "${op.newLabel}"`;
}

async function performDelete(version: Version): Promise<void> {
  const result = await deleteVersion(version.id);
  if (!result) return; // refused (last remaining version) or not found
  undoStack.push({ kind: 'delete', version: result.deleted, wasCurrent: result.wasCurrent });
  redoStack = [];
  if (result.wasCurrent && result.newCurrent) await cbs?.onSyncEditor(result.newCurrent);
  await refreshVersions();
}

async function performRename(version: Version): Promise<void> {
  const next = await promptRename(version.label);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === version.label) return;
  await renameVersion(version.id, trimmed);
  undoStack.push({ kind: 'rename', versionId: version.id, oldLabel: version.label, newLabel: trimmed });
  redoStack = [];
  await refreshVersions();
}

async function undo(): Promise<void> {
  const op = undoStack.pop();
  if (!op) return;
  if (op.kind === 'delete') {
    await restoreVersion(op.version, op.wasCurrent);
    if (op.wasCurrent) await cbs?.onSyncEditor(op.version);
  } else {
    await renameVersion(op.versionId, op.oldLabel);
  }
  redoStack.push(op);
  await refreshVersions();
}

async function redo(): Promise<void> {
  const op = redoStack.pop();
  if (!op) return;
  if (op.kind === 'delete') {
    const result = await deleteVersion(op.version.id);
    if (!result) { redoStack.push(op); await refreshVersions(); return; }
    if (result.wasCurrent && result.newCurrent) await cbs?.onSyncEditor(result.newCurrent);
  } else {
    await renameVersion(op.versionId, op.newLabel);
  }
  undoStack.push(op);
  await refreshVersions();
}

/** Small modal asking for a new version label. Resolves with the entered text,
 *  or null if cancelled/dismissed. */
function promptRename(current: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const shell = createModalShell({
      title: 'Rename version',
      onClose: () => { document.removeEventListener('keydown', onKey); resolve(result); },
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'w-full bg-zinc-900 text-zinc-100 text-sm px-3 py-2 rounded border border-zinc-600 outline-none focus:border-blue-500';
    shell.body.appendChild(input);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = BUTTON_PRIMARY;
    okBtn.textContent = 'Rename';
    okBtn.addEventListener('click', () => { result = input.value; shell.close(); });
    shell.footer.appendChild(okBtn);

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); result = input.value; shell.close(); }
    }
    document.addEventListener('keydown', onKey);

    input.focus();
    input.select();
  });
}
