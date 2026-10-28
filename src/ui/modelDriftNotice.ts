// "Built differently than saved" — the notice shown when an opened version's
// code now builds a different model than the one saved with it (an app update
// changed a builder, or the code is random). A persistent viewport pill (status,
// not a toast: it stays while the drifted version is on screen) opens a dialog
// that shows the saved thumbnail and offers:
//   - Restore the saved model — the version's stored mesh, as a new version
//     (only each object's newest version keeps a mesh);
//   - Keep the new model — save the rebuilt result as a new version;
//   - Ignore — stop showing the notice for this version on this device.
// main.ts owns the state and the actions; this module is just the UI.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SECONDARY } from './styleConstants';

export interface ModelDriftInfo {
  versionIndex: number;
  versionLabel: string;
  /** App version the version was saved with (null when not recorded). */
  savedWith: string | null;
  /** The running app version ('unknown' in dev builds). */
  running: string;
  /** Plain-words differences, largest first. */
  diffs: string[];
  /** True when the version kept its saved mesh, so it can be restored. */
  canRestore: boolean;
  /** The version's saved thumbnail, shown as "Saved". */
  thumbnail: Blob | null;
}

export interface ModelDriftActions {
  restore(): Promise<{ error?: string }>;
  keep(): Promise<{ error?: string }>;
  dismiss(): void;
}

const PILL_TEXT = '⟲ Built differently than saved';
const PILL_TITLE = 'This version’s code now builds a different model than the one saved with it — usually because Partwright was updated since it was saved. Click to compare, restore the saved model, or keep the new one.';

/** The persistent viewport pill. Hidden until `show`. */
export function mountModelDriftPill(parent: HTMLElement, onOpen: () => void): { show(): void; hide(): void } {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'absolute top-14 left-2 z-20 text-xs text-violet-200 font-mono bg-zinc-900/85 px-2 py-0.5 rounded border border-violet-600/60 cursor-pointer hover:bg-zinc-800/90 transition-colors';
  el.textContent = PILL_TEXT;
  el.title = PILL_TITLE;
  el.dataset.testid = 'model-drift-pill';
  el.style.display = 'none';
  el.addEventListener('click', onOpen);
  parent.appendChild(el);
  return {
    show: () => { el.style.display = ''; },
    hide: () => { el.style.display = 'none'; },
  };
}

/** One sentence on where the difference comes from. */
export function driftOrigin(savedWith: string | null, running: string): string {
  const known = running && running !== 'unknown';
  if (savedWith && known && savedWith === running) {
    return `It was saved with this same version of Partwright (v${running}), so the code itself builds differently on each run — for example it uses random numbers or the time.`;
  }
  if (savedWith && known) return `It was saved with Partwright v${savedWith}; this is v${running}, which builds the same code differently.`;
  if (savedWith) return `It was saved with Partwright v${savedWith}, and this build makes the same code come out differently.`;
  return 'It was saved with an earlier build of Partwright, which built the same code differently.';
}

export function showModelDriftDialog(info: ModelDriftInfo, actions: ModelDriftActions): void {
  let thumbUrl: string | null = null;
  const shell = createModalShell({
    title: 'Built differently than saved',
    maxWidth: 'lg',
    scrollable: true,
    onClose: () => { if (thumbUrl) URL.revokeObjectURL(thumbUrl); },
  });

  const name = info.versionLabel && info.versionLabel !== `v${info.versionIndex}`
    ? `v${info.versionIndex} (${info.versionLabel})`
    : `v${info.versionIndex}`;
  const lead = document.createElement('p');
  lead.className = 'text-sm text-zinc-200 leading-relaxed';
  lead.textContent = `Opening ${name} re-ran its code, and the model it builds now differs from the one saved: ${info.diffs.slice(0, 3).join(', ')}.`;
  shell.body.appendChild(lead);

  const origin = document.createElement('p');
  origin.className = 'text-xs text-zinc-400 leading-relaxed';
  origin.textContent = driftOrigin(info.savedWith, info.running);
  shell.body.appendChild(origin);

  if (info.thumbnail) {
    const fig = document.createElement('figure');
    fig.className = 'flex flex-col items-center gap-1';
    const img = document.createElement('img');
    thumbUrl = URL.createObjectURL(info.thumbnail);
    img.src = thumbUrl;
    img.alt = 'The model as it was saved';
    img.className = 'max-h-48 rounded border border-zinc-700 bg-zinc-900';
    const cap = document.createElement('figcaption');
    cap.className = 'text-[11px] text-zinc-400';
    cap.textContent = 'Saved — the viewport behind this dialog shows it now.';
    fig.append(img, cap);
    shell.body.appendChild(fig);
  }

  const explain = document.createElement('p');
  explain.className = 'text-xs text-zinc-400 leading-relaxed';
  explain.textContent = info.canRestore
    ? 'Either choice adds a new version and leaves this one’s code as it is. Only the newest version keeps a saved mesh, so after Keep the new model this saved one can no longer be restored.'
    : 'This version has no saved mesh to restore: only each object’s newest version keeps one. You can keep the new model, or leave it as it is.';
  shell.body.appendChild(explain);

  const status = document.createElement('p');
  status.className = 'text-xs text-amber-300 hidden';
  status.setAttribute('role', 'status');
  shell.body.appendChild(status);

  const buttons: HTMLButtonElement[] = [];
  const run = async (fn: () => Promise<{ error?: string }>) => {
    for (const b of buttons) b.disabled = true;
    const r = await fn();
    if (r.error) {
      status.textContent = r.error;
      status.classList.remove('hidden');
      for (const b of buttons) b.disabled = false;
      return;
    }
    shell.close();
  };

  const ignore = document.createElement('button');
  ignore.className = BUTTON_CANCEL;
  ignore.textContent = 'Ignore';
  ignore.title = 'Leave this version as it is and stop showing this notice for it on this device.';
  ignore.addEventListener('click', () => { actions.dismiss(); shell.close(); });
  shell.footer.appendChild(ignore);

  const keep = document.createElement('button');
  keep.className = info.canRestore ? BUTTON_SECONDARY : BUTTON_PRIMARY;
  keep.textContent = 'Keep the new model';
  keep.addEventListener('click', () => { void run(actions.keep); });
  buttons.push(keep);
  shell.footer.appendChild(keep);

  if (info.canRestore) {
    const restore = document.createElement('button');
    restore.className = BUTTON_PRIMARY;
    restore.textContent = 'Restore the saved model';
    restore.addEventListener('click', () => { void run(actions.restore); });
    buttons.push(restore);
    shell.footer.appendChild(restore);
  }
}
