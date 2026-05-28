// Session list modal — browse, create, delete sessions

import {
  listSessions,
  createSession,
  deleteSession,
  openSession,
  importSession,
  clearAllSessions,
  exportSession,
  effectiveVersionLanguage,
  type Session,
  type ExportedSession,
} from '../storage/sessionManager';
import { getSessionLatestVersion, getSessionVersionCount } from '../storage/db';

let modalEl: HTMLElement | null = null;
let onLoadVersion: ((code: string) => void | Promise<void>) | null = null;
let regenerateThumbnailFn: ((code: string) => Promise<Blob | null>) | null = null;
let onNewSessionFn: (() => void) | null = null;

export function initSessionList(
  loadCode: (code: string) => void | Promise<void>,
  regenerateThumbnail?: (code: string) => Promise<Blob | null>,
  onNewSession?: () => void,
): void {
  onLoadVersion = loadCode;
  regenerateThumbnailFn = regenerateThumbnail ?? null;
  onNewSessionFn = onNewSession ?? null;
}

export async function showSessionList(): Promise<void> {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-lg max-h-[70vh] flex flex-col';

  // Header
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between px-5 py-3 border-b border-zinc-700';

  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = 'Sessions';
  header.appendChild(title);

  const headerActions = document.createElement('div');
  headerActions.className = 'flex gap-2';

  const importBtn = document.createElement('button');
  importBtn.className = 'px-3 py-1 rounded text-xs bg-zinc-600 hover:bg-zinc-500 text-white transition-colors';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as ExportedSession;
        if ((!data.partwright && !data.mainifold) || !data.session || !Array.isArray(data.versions)) {
          alert('Invalid session file.');
          return;
        }
        const session = await importSession(data, regenerateThumbnailFn ?? undefined, (msg) => alert(msg));
        const version = await openSession(session.id);
        if (version && onLoadVersion) onLoadVersion(version.code);
        closeModal();
      } catch (e) {
        alert('Failed to import session: ' + (e as Error).message);
      }
    });
    input.click();
  });
  headerActions.appendChild(importBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-3 py-1 rounded text-xs bg-red-900/50 hover:bg-red-800 text-red-300 transition-colors';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', async () => {
    if (confirm('Delete ALL sessions and versions? This cannot be undone.')) {
      await clearAllSessions();
      closeModal();
    }
  });
  headerActions.appendChild(clearBtn);

  const newBtn = document.createElement('button');
  newBtn.className = 'px-3 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  newBtn.textContent = '+ New Session';
  newBtn.addEventListener('click', async () => {
    const name = prompt('Session name:');
    if (name === null) return;
    await createSession(name || undefined);
    onNewSessionFn?.();
    closeModal();
  });
  headerActions.appendChild(newBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  headerActions.appendChild(closeBtn);

  header.appendChild(headerActions);
  modal.appendChild(header);

  // Session list
  const listContainer = document.createElement('div');
  listContainer.className = 'flex-1 overflow-auto';

  const sessions = await listSessions();

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex items-center justify-center py-12 text-zinc-500 text-sm';
    empty.textContent = 'No sessions yet. Create one to start tracking versions.';
    listContainer.appendChild(empty);
  } else {
    for (const session of sessions) {
      listContainer.appendChild(await createSessionRow(session));
    }
  }

  modal.appendChild(listContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

async function createSessionRow(session: Session): Promise<HTMLElement> {
  const [count, latestVersion] = await Promise.all([
    getSessionVersionCount(session.id),
    getSessionLatestVersion(session.id),
  ]);

  const row = document.createElement('div');
  row.className = 'flex items-center gap-3 px-5 py-3 hover:bg-zinc-700/50 cursor-pointer border-b border-zinc-700/50 transition-colors';

  row.addEventListener('click', async () => {
    const version = await openSession(session.id);
    if (version && onLoadVersion) {
      await onLoadVersion(version.code);
    }
    closeModal();
  });

  // Thumbnail preview (same render as the landing-page session tiles)
  const thumb = document.createElement('div');
  thumb.className = 'w-12 h-12 rounded bg-zinc-900 border border-zinc-700/50 flex items-center justify-center overflow-hidden shrink-0';
  if (latestVersion?.thumbnail) {
    const img = document.createElement('img');
    img.className = 'w-full h-full object-contain';
    img.src = URL.createObjectURL(latestVersion.thumbnail);
    img.loading = 'lazy';
    img.alt = session.name;
    img.addEventListener('load', () => URL.revokeObjectURL(img.src));
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'text-lg text-zinc-700';
    placeholder.textContent = '⬡';
    thumb.appendChild(placeholder);
  }
  row.appendChild(thumb);

  // Info
  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';

  const name = document.createElement('div');
  name.className = 'text-sm text-zinc-200 truncate';
  name.textContent = session.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'text-xs text-zinc-500 font-mono mt-0.5 flex items-center gap-1.5';
  // Latest version's language (per-version since schema 1.8) with fallback to
  // the session-level hint, so old data still renders the right badge.
  const sessionLang = effectiveVersionLanguage(latestVersion, session);
  const langLabel = sessionLang === 'scad' ? 'SCAD' : 'JS';
  const langColor = sessionLang === 'scad' ? 'text-amber-400 border-amber-400/30' : 'text-blue-400 border-blue-400/30';
  meta.innerHTML = `<span class="text-[10px] font-semibold border rounded px-1 ${langColor}">${langLabel}</span>${count} version${count !== 1 ? 's' : ''} · ${formatDate(session.updated)}`;
  info.appendChild(meta);

  row.appendChild(info);

  // Export button
  const expBtn = document.createElement('button');
  expBtn.className = 'px-2 py-1 rounded text-zinc-500 hover:text-blue-400 hover:bg-zinc-700 text-xs transition-colors';
  expBtn.textContent = 'Export';
  expBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const data = await exportSession(session.id);
    if (!data) return;
    if (data.versions.length === 0) {
      alert(
        `"${session.name}" has no saved versions, so the export would be empty.\n\n` +
        `Open the session, save a version (\u{1F4BE} Save), then export.`,
      );
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${session.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.partwright.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  row.appendChild(expBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'px-2 py-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700 text-xs transition-colors';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${session.name}" and all its versions?`)) {
      await deleteSession(session.id);
      row.remove();
    }
  });
  row.appendChild(delBtn);

  return row;
}

function closeModal() {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return 'today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
