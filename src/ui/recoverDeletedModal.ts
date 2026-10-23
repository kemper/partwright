// "Recover deleted" — one place to bring back what was deleted in the active
// session: OBJECTS moved to the deleted-objects bin (restorable until they
// expire) and PARTS / PIECES removed in code by the object list's ✕ (an
// `api.removePart` / `api.removePiece` line, or OpenSCAD `remove_part` /
// `remove_piece` — restorable while the line is there). Opened from the Objects rail footer, the command palette, and
// `partwright.showRecoverDeleted()`. The data and the restore actions come from
// main.ts through a controller, so this module only renders.

import { createModalShell, type ModalShell } from './modalShell';
import { BUTTON_CANCEL, BUTTON_SMALL_DANGER, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { confirmDialog } from './dialogs';
import { showToast } from './toast';

export interface RecoverableObject {
  id: string;
  name: string;
  group?: string;
  versionCount: number;
  deletedAt: number;
  expiresAt: number;
  thumbnail: Blob | null;
}

export interface RecoverablePart {
  objectId: string;
  objectName: string;
  kind: 'part' | 'piece';
  /** What the row shows — `part "wheel"` / `piece 3 ("hub")`. */
  title: string;
  /** The canonical removal call — the id a restore targets. */
  call: string;
  /** True when the part belongs to the open object (no switch on restore). */
  current: boolean;
}

export interface RecoverDeletedController {
  list(): Promise<{ objects: RecoverableObject[]; parts: RecoverablePart[] }>;
  /** Restore a binned object. Resolves to an error message, or null. */
  restoreObject(id: string): Promise<string | null>;
  /** Restore a removed part/piece (switches to its object first when needed).
   *  Resolves to an error message, `{ note }` when the line was dropped but
   *  nothing came back, or null. */
  restorePart(objectId: string, call: string): Promise<string | { note: string } | null>;
  /** Permanently delete one binned object. Resolves to an error message, or null. */
  purgeObject(id: string): Promise<string | null>;
  /** Permanently delete every binned object of the session. Error, or null. */
  emptyBin(): Promise<string | null>;
  /** Read-only viewer / shared preview: list only, no actions. */
  readOnly(): boolean;
  retentionDays(): number;
}

let shell: ModalShell | null = null;
let ctl: RecoverDeletedController | null = null;
let thumbUrls: string[] = [];
let renderSeq = 0;

function revokeThumbs(): void {
  for (const u of thumbUrls) URL.revokeObjectURL(u);
  thumbUrls = [];
}

/** Re-render the open modal (no-op when closed) — called after a delete or a
 *  restore made elsewhere so the list stays current. */
export function refreshRecoverDeletedModal(): void {
  if (shell) void render();
}

export function openRecoverDeletedModal(controller: RecoverDeletedController): void {
  ctl = controller;
  shell = createModalShell({
    title: 'Recover deleted',
    maxWidth: 'lg',
    scrollable: true,
    onClose: () => { shell = null; ctl = null; revokeThumbs(); },
  });
  shell.body.dataset.recoverDeleted = '';
  const done = document.createElement('button');
  done.className = BUTTON_CANCEL;
  done.textContent = 'Close';
  done.addEventListener('click', () => shell?.close());
  shell.footer.appendChild(done);
  void render();
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function sectionHeading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500';
  h.textContent = text;
  return h;
}

function emptyNote(text: string): HTMLElement {
  const n = document.createElement('div');
  n.className = 'text-xs text-zinc-500 italic';
  n.textContent = text;
  return n;
}

function rowShell(): HTMLElement {
  const row = document.createElement('div');
  // Wraps so the buttons drop under the name on a phone-width modal.
  row.className = 'flex flex-wrap items-center justify-end gap-2 px-2 py-1.5 rounded bg-zinc-900/60 border border-zinc-700/60 min-h-[44px]';
  return row;
}

function textBlock(main: string, sub: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'flex-1 min-w-[10rem]';
  const a = document.createElement('div');
  a.className = 'text-xs text-zinc-200 truncate';
  a.textContent = main;
  a.title = main;
  const b = document.createElement('div');
  b.className = 'text-[11px] text-zinc-500 truncate';
  b.textContent = sub;
  b.title = sub;
  box.append(a, b);
  return box;
}

/** Run a row action with its buttons disabled, then report + re-render. The
 *  action resolves to an error message, a `{ note }` to show instead of the
 *  success message, or null. */
async function act(row: HTMLElement, fn: () => Promise<string | { note: string } | null>, ok: string): Promise<void> {
  for (const b of row.querySelectorAll('button')) b.disabled = true;
  const r = await fn().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof r === 'string') showToast(r, { variant: 'warn' });
  else if (r) showToast(r.note, { variant: 'neutral' });
  else showToast(ok, { variant: 'success' });
  await render();
}

async function render(): Promise<void> {
  if (!shell || !ctl) return;
  const seq = ++renderSeq;
  const c = ctl;
  const data = await c.list();
  // A newer render started (or the modal closed) while this one awaited.
  if (seq !== renderSeq || !shell || ctl !== c) return;
  revokeThumbs();
  const body = shell.body;
  body.innerHTML = '';
  const readOnly = c.readOnly();

  // --- Objects ---
  body.appendChild(sectionHeading(`Objects · ${data.objects.length}`));
  if (data.objects.length === 0) body.appendChild(emptyNote('No deleted objects in this session.'));
  for (const o of data.objects) {
    const row = rowShell();
    row.dataset.recoverObject = o.id;
    const thumb = document.createElement('span');
    thumb.className = 'shrink-0 w-10 h-10 rounded bg-zinc-950 overflow-hidden flex items-center justify-center';
    if (o.thumbnail) {
      const url = URL.createObjectURL(o.thumbnail);
      thumbUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.className = 'w-full h-full object-contain';
      thumb.appendChild(img);
    }
    row.appendChild(thumb);
    const versions = `${o.versionCount} version${o.versionCount === 1 ? '' : 's'}`;
    const days = Math.max(0, Math.ceil((o.expiresAt - Date.now()) / 86_400_000));
    row.appendChild(textBlock(o.group ? `${o.group} / ${o.name}` : o.name, `${versions} · deleted ${ago(o.deletedAt)} · expires in ${days} day${days === 1 ? '' : 's'}`));
    if (!readOnly) {
      const restore = document.createElement('button');
      restore.className = `${BUTTON_SMALL_SECONDARY} min-h-[44px] md:min-h-0`;
      restore.textContent = 'Restore';
      restore.title = `Restore "${o.name}" with all of its versions`;
      restore.addEventListener('click', () => { void act(row, () => c.restoreObject(o.id), `Restored object "${o.name}".`); });
      const purge = document.createElement('button');
      purge.className = BUTTON_SMALL_DANGER;
      purge.textContent = 'Delete forever';
      purge.title = `Permanently delete "${o.name}" and its versions`;
      purge.addEventListener('click', async () => {
        if (!(await confirmDialog(`Permanently delete "${o.name}" and its ${versions}? This cannot be undone.`, { title: 'Delete forever', confirmLabel: 'Delete forever', danger: true }))) return;
        void act(row, () => c.purgeObject(o.id), `Permanently deleted "${o.name}".`);
      });
      row.append(restore, purge);
    }
    body.appendChild(row);
  }

  // --- Parts & pieces ---
  body.appendChild(sectionHeading(`Parts & pieces · ${data.parts.length}`));
  if (data.parts.length === 0) body.appendChild(emptyNote('No removed parts or pieces in this session’s objects.'));
  for (const p of data.parts) {
    const row = rowShell();
    row.dataset.recoverPart = p.call;
    row.dataset.recoverPartObject = p.objectId;
    row.appendChild(textBlock(`${p.objectName} ▸ ${p.title}`, p.call));
    if (!readOnly) {
      const restore = document.createElement('button');
      restore.className = `${BUTTON_SMALL_SECONDARY} min-h-[44px] md:min-h-0`;
      restore.textContent = p.current ? 'Restore' : `Restore (opens ${p.objectName})`;
      restore.title = `Remove ${p.call} from the code of "${p.objectName}", re-run and save a version`;
      restore.addEventListener('click', () => { void act(row, () => c.restorePart(p.objectId, p.call), `Restored ${p.title}.`); });
      row.appendChild(restore);
    }
    body.appendChild(row);
  }

  // --- Footer note + empty bin ---
  const foot = document.createElement('div');
  foot.className = 'flex items-center gap-2 pt-1';
  const note = document.createElement('div');
  note.className = 'flex-1 text-[11px] text-zinc-500 leading-snug';
  note.textContent = `Deleted objects are kept ${c.retentionDays()} days. Removed parts and pieces stay recoverable while their removal line is in the code.`;
  foot.appendChild(note);
  if (!readOnly && data.objects.length > 0) {
    const empty = document.createElement('button');
    empty.className = `shrink-0 ${BUTTON_SMALL_DANGER}`;
    empty.textContent = 'Empty bin';
    empty.title = 'Permanently delete every deleted object listed above';
    empty.addEventListener('click', async () => {
      const n = data.objects.length;
      if (!(await confirmDialog(`Permanently delete ${n} deleted object${n === 1 ? '' : 's'} and all of their versions? This cannot be undone.`, { title: 'Empty bin', confirmLabel: 'Delete forever', danger: true }))) return;
      const err = await c.emptyBin();
      if (err) showToast(err, { variant: 'warn' });
      else showToast(`Permanently deleted ${n} object${n === 1 ? '' : 's'}.`, { variant: 'success' });
      await render();
    });
    foot.appendChild(empty);
  }
  body.appendChild(foot);
}
