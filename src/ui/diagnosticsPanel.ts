// Floating diagnostic log panel. Surfaces captured errors and warnings from
// all subsystems in one place. Opened/closed via the toolbar ⚠ button.
//
// Call initDiagnosticsPanel() once after createToolbar() so the badge
// setter is available when new entries arrive.

import { errorLog, type LogEntry, type ErrorLevel } from '../diagnostics/errorLog';
import { setDiagnosticsToolbarBadge } from './toolbar';

let _panelEl: HTMLElement | null = null;
let _listEl: HTMLElement | null = null;
let _isOpen = false;
let _currentFilter: ErrorLevel | 'all' = 'all';
let _unseenCount = 0;

// Entry IDs the user has expanded. Tracked at module scope so an open row's
// state survives the full list rebuild that happens when a new entry arrives.
const _expandedIds = new Set<string>();

// Filter chip elements stored so syncFilterChips() can update them.
let _filterBtns: Array<{ el: HTMLButtonElement; value: ErrorLevel | 'all' }> = [];

function syncFilterChips(): void {
  for (const { el, value } of _filterBtns) {
    const active = value === _currentFilter;
    el.className = active
      ? 'text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-200 transition-colors'
      : 'text-[10px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors';
  }
}

function makeFilterChip(label: string, value: ErrorLevel | 'all'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    _currentFilter = value;
    syncFilterChips();
    renderEntries(errorLog.getEntries());
  });
  _filterBtns.push({ el: btn, value });
  return btn;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function buildEntryEl(entry: LogEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'border-b border-zinc-800/60';

  const top = document.createElement('div');
  top.className =
    'flex items-center gap-1.5 px-3 py-1.5 min-w-0 cursor-pointer select-none hover:bg-zinc-800/30 transition-colors';

  const caret = document.createElement('span');
  caret.className = 'text-[10px] text-zinc-600 shrink-0';
  top.appendChild(caret);

  const time = document.createElement('span');
  time.className = 'text-[10px] text-zinc-600 font-mono shrink-0 tabular-nums';
  time.textContent = formatTime(entry.timestamp);
  top.appendChild(time);

  const levelEl = document.createElement('span');
  levelEl.className =
    entry.level === 'error'
      ? 'text-[9px] font-bold tracking-wider text-red-400 shrink-0'
      : 'text-[9px] font-bold tracking-wider text-amber-400 shrink-0';
  levelEl.textContent = entry.level === 'error' ? '● ERR' : '● WARN';
  top.appendChild(levelEl);

  const sourceEl = document.createElement('span');
  sourceEl.className =
    'text-[9px] uppercase tracking-wide text-zinc-500 border border-zinc-700 rounded px-1 shrink-0';
  sourceEl.textContent = entry.source;
  top.appendChild(sourceEl);

  const msgEl = document.createElement('span');
  msgEl.className = 'text-xs text-zinc-300 truncate flex-1 min-w-0';
  msgEl.textContent = entry.message;
  top.appendChild(msgEl);

  row.appendChild(top);

  // Expanded view: the full (untruncated) message, a precise timestamp with
  // source/level, and the captured stack or origin trace when available.
  const expanded = document.createElement('div');
  expanded.className = 'px-3 pb-2 pt-0.5 space-y-1.5';

  const fullMsg = document.createElement('div');
  fullMsg.className =
    'text-[11px] text-zinc-300 whitespace-pre-wrap break-words leading-relaxed';
  fullMsg.textContent = entry.message;
  expanded.appendChild(fullMsg);

  const meta = document.createElement('div');
  meta.className = 'text-[10px] text-zinc-500 font-mono break-words';
  meta.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${entry.level.toUpperCase()} · source: ${entry.source}`;
  expanded.appendChild(meta);

  if (entry.detail) {
    const detail = document.createElement('pre');
    detail.className =
      'text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-words max-h-48 overflow-auto leading-4 bg-zinc-950/60 rounded p-2 border border-zinc-800';
    detail.textContent = entry.detail;
    expanded.appendChild(detail);
  } else {
    const none = document.createElement('div');
    none.className = 'text-[10px] text-zinc-600 italic';
    none.textContent = 'No stack trace or origin captured for this entry.';
    expanded.appendChild(none);
  }

  row.appendChild(expanded);

  const sync = (open: boolean) => {
    expanded.classList.toggle('hidden', !open);
    caret.textContent = open ? '▾' : '▸';
  };
  sync(_expandedIds.has(entry.id));

  top.addEventListener('click', () => {
    const open = !_expandedIds.has(entry.id);
    if (open) _expandedIds.add(entry.id);
    else _expandedIds.delete(entry.id);
    sync(open);
  });

  return row;
}

function renderEntries(all: readonly LogEntry[]): void {
  if (!_listEl) return;
  if (all.length === 0) _expandedIds.clear();
  const filtered =
    _currentFilter === 'all' ? all : all.filter((e) => e.level === _currentFilter);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className =
      'flex items-center justify-center h-full text-zinc-600 text-xs py-8';
    empty.textContent = 'No entries to show.';
    _listEl.replaceChildren(empty);
    return;
  }

  _listEl.replaceChildren(...filtered.map(buildEntryEl));
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'diagnostics-panel';
  panel.className = [
    'hidden fixed bottom-0 left-0 right-0',
    'md:left-auto md:right-4 md:bottom-4 md:w-[480px] md:rounded-xl',
    'h-[300px] bg-zinc-900 border border-zinc-700 shadow-2xl flex flex-col z-[45]',
  ].join(' ');

  // Header
  const header = document.createElement('div');
  header.className =
    'flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0';

  const titleEl = document.createElement('span');
  titleEl.className = 'text-xs font-semibold text-zinc-300 shrink-0';
  titleEl.textContent = 'Diagnostic Log';
  header.appendChild(titleEl);

  const filterGroup = document.createElement('div');
  filterGroup.className = 'flex items-center gap-1 ml-2';
  filterGroup.appendChild(makeFilterChip('All', 'all'));
  filterGroup.appendChild(makeFilterChip('Errors', 'error'));
  filterGroup.appendChild(makeFilterChip('Warnings', 'warn'));
  header.appendChild(filterGroup);
  syncFilterChips();

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';
  header.appendChild(spacer);

  const copyBtn = document.createElement('button');
  copyBtn.className =
    'text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy log to clipboard';
  copyBtn.addEventListener('click', () => {
    const text = errorLog
      .getEntries()
      .map(
        (e) =>
          `[${formatTime(e.timestamp)}] ${e.level.toUpperCase()} (${e.source}) ${e.message}${e.detail ? '\n' + e.detail : ''}`,
      )
      .join('\n---\n');
    void navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    });
  });
  header.appendChild(copyBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className =
    'text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 ml-1';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Clear all log entries';
  clearBtn.addEventListener('click', () => {
    errorLog.clear();
  });
  header.appendChild(clearBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className =
    'flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors ml-1 text-base leading-none';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', toggleDiagnosticsPanel);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  _listEl = document.createElement('div');
  _listEl.className = 'flex-1 overflow-y-auto';
  panel.appendChild(_listEl);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _isOpen) toggleDiagnosticsPanel();
  });

  return panel;
}

export function initDiagnosticsPanel(): void {
  _panelEl = buildPanel();
  document.body.appendChild(_panelEl);

  errorLog.subscribe((entries) => {
    if (!_isOpen) {
      // entries.length === 0 means the log was cleared.
      if (entries.length === 0) {
        _unseenCount = 0;
      } else {
        _unseenCount++;
      }
      setDiagnosticsToolbarBadge(_unseenCount);
    } else {
      renderEntries(entries);
    }
  });
}

export function toggleDiagnosticsPanel(): void {
  if (!_panelEl) return;
  _isOpen = !_isOpen;
  _panelEl.classList.toggle('hidden', !_isOpen);
  if (_isOpen) {
    _unseenCount = 0;
    setDiagnosticsToolbarBadge(0);
    renderEntries(errorLog.getEntries());
  }
}
