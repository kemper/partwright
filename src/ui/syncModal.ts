// "Backup & sync" modal — connect/disconnect the local-folder and Google Drive
// backup targets, see live status, and restore a session from a backup file.
// Vanilla DOM on the shared modal shell (matches the app's non-preact modals).

import { createModalShell } from './modalShell';
import { showToast } from './toast';
import { BUTTON_SMALL_SECONDARY } from './styleConstants';
import type { ExportedSession } from '../storage/sessionManager';
import type { SyncTargetId, SyncTargetStatus } from '../sync/syncTypes';
import {
  onSyncChange,
  getSyncStatuses,
  connectLocal,
  reconnectLocal,
  disconnectLocal,
  connectDrive,
  disconnectDriveTarget,
  backupAllSessions,
  listBackups,
  readBackup,
} from '../sync/syncManager';
import { isLocalFolderSupported } from '../sync/localFolder';
import { isDriveConfigured } from '../sync/googleDrive';

type ImportFn = (data: ExportedSession) => Promise<{ sessionId: string }>;

const PHASE_TEXT: Record<SyncTargetStatus['phase'], string> = {
  disconnected: 'Not connected',
  connected: 'Connected',
  syncing: 'Syncing…',
  'needs-reconnect': 'Reconnect needed',
  error: 'Error',
};

const PHASE_COLOR: Record<SyncTargetStatus['phase'], string> = {
  disconnected: 'text-zinc-500',
  connected: 'text-emerald-400',
  syncing: 'text-blue-400',
  'needs-reconnect': 'text-amber-400',
  error: 'text-red-400',
};

function fmtTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `last backup ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function showSyncModal(onImport: ImportFn): void {
  let unsub: () => void = () => {};
  const shell = createModalShell({
    title: 'Backup & sync',
    maxWidth: 'lg',
    onClose: () => unsub(),
  });

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-relaxed';
  intro.textContent =
    'Automatically save a copy of your sessions outside the browser. Connect a folder on ' +
    'your computer, your Google Drive, or both — the session you’re working on is written ' +
    'as a .partwright.json file on every change.';
  shell.body.appendChild(intro);

  const localCard = buildCard('local');
  const driveCard = buildCard('drive');
  shell.body.appendChild(localCard.el);
  shell.body.appendChild(driveCard.el);

  const cards = { local: localCard, drive: driveCard };

  const render = (statuses: Record<SyncTargetId, SyncTargetStatus>) => {
    cards.local.update(statuses.local);
    cards.drive.update(statuses.drive);
  };
  render(getSyncStatuses());
  unsub = onSyncChange(render);

  // "Back up all sessions now" footer action + Done.
  const backupAllBtn = document.createElement('button');
  backupAllBtn.type = 'button';
  backupAllBtn.className = BUTTON_SMALL_SECONDARY;
  backupAllBtn.textContent = 'Back up all sessions now';
  backupAllBtn.onclick = async () => {
    backupAllBtn.disabled = true;
    backupAllBtn.textContent = 'Backing up…';
    try {
      const n = await backupAllSessions();
      showToast(`Backed up ${n} session${n === 1 ? '' : 's'}.`, { variant: 'success', source: 'export' });
    } catch (e) {
      showToast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, { variant: 'warn', source: 'export' });
    } finally {
      backupAllBtn.disabled = false;
      backupAllBtn.textContent = 'Back up all sessions now';
    }
  };

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'px-4 py-1.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-700 transition-colors';
  doneBtn.textContent = 'Done';
  doneBtn.onclick = () => shell.close();

  shell.footer.appendChild(backupAllBtn);
  shell.footer.appendChild(doneBtn);

  // ── card factory ──────────────────────────────────────────────────────────
  function buildCard(id: SyncTargetId) {
    const el = document.createElement('div');
    el.className = 'mt-3 rounded-lg border border-zinc-700 bg-zinc-800/40 p-3';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3';
    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'text-sm font-medium text-zinc-200';
    title.textContent = id === 'local' ? 'Local folder' : 'Google Drive';
    const sub = document.createElement('div');
    sub.className = 'text-[11px] text-zinc-500 mt-0.5';
    sub.textContent =
      id === 'local'
        ? 'A directory on this computer (Chrome/Edge).'
        : 'A “partwright” folder in your Drive (this app’s files only).';
    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);

    const statusEl = document.createElement('div');
    statusEl.className = 'text-xs font-medium text-right whitespace-nowrap';
    header.appendChild(titleWrap);
    header.appendChild(statusEl);
    el.appendChild(header);

    const detail = document.createElement('div');
    detail.className = 'text-[11px] text-zinc-500 mt-1';
    el.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'flex flex-wrap gap-2 mt-2';
    el.appendChild(actions);

    const restorePanel = document.createElement('div');
    restorePanel.className = 'mt-2 hidden';
    el.appendChild(restorePanel);

    const btn = (label: string, onClick: () => void, danger = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = danger
        ? 'px-2 py-1 rounded text-[11px] text-red-400 border border-red-400/30 hover:bg-red-400/10'
        : BUTTON_SMALL_SECONDARY;
      b.textContent = label;
      b.onclick = onClick;
      return b;
    };

    const update = (s: SyncTargetStatus) => {
      statusEl.textContent = PHASE_TEXT[s.phase];
      statusEl.className = `text-xs font-medium text-right whitespace-nowrap ${PHASE_COLOR[s.phase]}`;
      detail.textContent = s.lastError || (s.label ? `${s.label} · ${fmtTime(s.lastSyncAt)}` : '');

      actions.replaceChildren();
      const supported = id === 'local' ? isLocalFolderSupported() : isDriveConfigured();
      if (!supported) {
        const note = document.createElement('div');
        note.className = 'text-[11px] text-zinc-500';
        note.textContent =
          id === 'local'
            ? 'This browser doesn’t support local folder access. Use Chrome or Edge, or export manually.'
            : 'Google Drive sync isn’t configured on this deployment yet.';
        actions.appendChild(note);
        return;
      }

      if (s.phase === 'disconnected') {
        actions.appendChild(btn('Connect…', () => void handleConnect(id)));
      } else {
        if (s.phase === 'needs-reconnect') {
          actions.appendChild(btn('Reconnect', () => void handleReconnect(id)));
        }
        actions.appendChild(btn('Restore…', () => void toggleRestore(id, restorePanel)));
        actions.appendChild(btn('Disconnect', () => void handleDisconnect(id), true));
      }
    };

    return { el, update };
  }

  async function handleConnect(id: SyncTargetId) {
    try {
      if (id === 'local') {
        const ok = await connectLocal();
        if (ok) showToast('Local folder connected — backing up.', { variant: 'success', source: 'export' });
      } else {
        connectDrive(); // navigates away to Google
      }
    } catch (e) {
      showToast(`Connect failed: ${e instanceof Error ? e.message : String(e)}`, { variant: 'warn', source: 'export' });
    }
  }

  async function handleReconnect(id: SyncTargetId) {
    try {
      if (id === 'local') {
        const ok = await reconnectLocal();
        showToast(ok ? 'Folder reconnected.' : 'Permission not granted.', {
          variant: ok ? 'success' : 'warn',
          source: 'export',
        });
      } else {
        connectDrive();
      }
    } catch (e) {
      showToast(`Reconnect failed: ${e instanceof Error ? e.message : String(e)}`, { variant: 'warn', source: 'export' });
    }
  }

  async function handleDisconnect(id: SyncTargetId) {
    if (id === 'local') await disconnectLocal();
    else await disconnectDriveTarget();
    showToast('Disconnected.', { variant: 'neutral', source: 'export' });
  }

  async function toggleRestore(id: SyncTargetId, panel: HTMLElement) {
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      panel.replaceChildren();
      return;
    }
    panel.classList.remove('hidden');
    panel.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'text-[11px] text-zinc-500';
    loading.textContent = 'Loading backups…';
    panel.appendChild(loading);
    try {
      const entries = await listBackups(id);
      panel.replaceChildren();
      if (entries.length === 0) {
        const none = document.createElement('div');
        none.className = 'text-[11px] text-zinc-500';
        none.textContent = 'No backups found in this target yet.';
        panel.appendChild(none);
        return;
      }
      const list = document.createElement('div');
      list.className = 'flex flex-col gap-1 max-h-40 overflow-auto';
      for (const entry of entries) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className =
          'text-left text-[11px] text-zinc-300 px-2 py-1 rounded hover:bg-zinc-700/60 border border-zinc-700/60 truncate';
        row.textContent = entry.name;
        row.onclick = async () => {
          row.disabled = true;
          try {
            const data = await readBackup(id, entry.key);
            await onImport(data);
            showToast(`Restored “${data.session?.name ?? entry.name}”.`, { variant: 'success', source: 'import' });
            shell.close();
          } catch (e) {
            showToast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, {
              variant: 'warn',
              source: 'import',
            });
            row.disabled = false;
          }
        };
        list.appendChild(row);
      }
      panel.appendChild(list);
    } catch (e) {
      panel.replaceChildren();
      const err = document.createElement('div');
      err.className = 'text-[11px] text-red-400';
      err.textContent = `Couldn’t list backups: ${e instanceof Error ? e.message : String(e)}`;
      panel.appendChild(err);
    }
  }
}
