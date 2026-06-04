// Floating diagnostics panel. Two stacked halves in one surface:
//   • Upper — Worker health: liveness, in-flight load, (re)start counts with
//     the last restart reason, and a ring buffer of recent geometry runs with
//     wall-clock vs worker-side compute timing (data from workerStats).
//   • Lower — the Diagnostic Log: captured errors/warnings/info from every
//     subsystem (data from errorLog).
//
// Opened/closed via the toolbar ⚠ button. Call initDiagnosticsPanel() once
// after createToolbar() so the badge setter is available when new entries
// arrive.

import { errorLog, type LogEntry, type ErrorLevel } from '../diagnostics/errorLog';
import {
  getWorkerHealth,
  getWorkerRuns,
  clearWorkerRuns,
  onWorkerStatsChange,
  type WorkerHealth,
  type WorkerRun,
  type RunStatus,
} from '../diagnostics/workerStats';
import { getConfig } from '../config/appConfig';
import { setDiagnosticsToolbarBadge } from './toolbar';

let _panelEl: HTMLElement | null = null;
let _listEl: HTMLElement | null = null;
let _workersScrollEl: HTMLElement | null = null;
let _isOpen = false;
let _currentFilter: ErrorLevel | 'all' = 'all';
let _unseenCount = 0;
// Polls live worker values (in-flight counts, liveness) while the panel is
// open — those change without firing a workerStats event.
let _pollTimer: number | null = null;

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

// ── Worker health (upper half) ───────────────────────────────────────────────

const RUN_DOT: Record<RunStatus, string> = {
  ok: 'bg-emerald-400',
  error: 'bg-red-400',
  timeout: 'bg-amber-400',
  cancelled: 'bg-zinc-500',
};

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;
}

/** A "label: value" stat fragment, matching the log rows' compact mono style. */
function statSpan(label: string, value: string | number, valueClass: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'text-zinc-500';
  wrap.appendChild(document.createTextNode(`${label} `));
  const v = document.createElement('span');
  v.className = valueClass;
  v.textContent = String(value);
  wrap.appendChild(v);
  return wrap;
}

function buildWorkerRow(w: WorkerHealth): HTMLElement {
  const row = document.createElement('div');
  row.className = 'px-3 py-1.5 border-b border-zinc-800/60';

  const top = document.createElement('div');
  top.className = 'flex items-center gap-1.5 min-w-0';

  const dot = document.createElement('span');
  dot.className = `inline-block w-2 h-2 rounded-full shrink-0 ${w.alive ? 'bg-emerald-400' : 'bg-zinc-600'}`;
  top.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'text-xs text-zinc-200 truncate flex-1 min-w-0';
  name.textContent = w.label;
  top.appendChild(name);

  if (w.inFlight > 0) {
    const badge = document.createElement('span');
    badge.className = 'text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-200 border border-amber-700/40 shrink-0';
    badge.textContent = `${w.inFlight} in flight`;
    top.appendChild(badge);
  }

  const status = document.createElement('span');
  status.className = 'text-[9px] uppercase tracking-wide text-zinc-500 shrink-0';
  status.textContent = w.alive ? 'running' : 'idle';
  top.appendChild(status);

  row.appendChild(top);

  const stats = document.createElement('div');
  stats.className = 'flex items-center gap-3 text-[10px] font-mono pl-3.5 mt-0.5';
  stats.appendChild(statSpan('starts:', w.startCount, 'text-zinc-300'));
  // A climbing restart count within a single session is the crash-loop tell.
  const restartTone = w.restartCount === 0
    ? 'text-zinc-400'
    : w.restartCount >= 3
      ? 'text-red-300'
      : 'text-amber-300';
  const restartStat = statSpan('restarts:', w.restartCount, restartTone);
  if (w.lastRestartReason) restartStat.title = w.lastRestartReason;
  stats.appendChild(restartStat);
  row.appendChild(stats);

  if (w.lastRestartReason) {
    const last = document.createElement('div');
    last.className = 'text-[10px] text-zinc-600 font-mono pl-3.5 truncate';
    const when = w.lastRestartAt ? ` (${formatTime(w.lastRestartAt)})` : '';
    last.textContent = `last restart: ${w.lastRestartReason}${when}`;
    last.title = w.lastRestartReason;
    row.appendChild(last);
  }

  return row;
}

function buildRunRow(run: WorkerRun): HTMLElement {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-1.5 px-3 py-0.5';

  const dot = document.createElement('span');
  dot.className = `inline-block w-1.5 h-1.5 rounded-full shrink-0 ${RUN_DOT[run.status]}`;
  row.appendChild(dot);

  const time = document.createElement('span');
  time.className = 'text-[10px] text-zinc-600 font-mono shrink-0 tabular-nums';
  time.textContent = formatTime(run.timestamp);
  row.appendChild(time);

  const kind = document.createElement('span');
  kind.className = 'text-[10px] text-zinc-400 font-mono shrink-0';
  kind.textContent = run.kind;
  row.appendChild(kind);

  const timing = run.workerMs != null
    ? `${fmtMs(run.durationMs)} (${fmtMs(run.workerMs)} compute)`
    : fmtMs(run.durationMs);
  const detail = document.createElement('span');
  detail.className = 'text-[10px] font-mono truncate flex-1 min-w-0 ' + (run.status === 'ok' ? 'text-zinc-500' : 'text-zinc-400');
  detail.textContent = run.status === 'ok'
    ? timing
    : `${run.status}${run.detail ? ` · ${run.detail}` : ` · ${timing}`}`;
  if (run.status !== 'ok' && run.detail) detail.title = run.detail;
  row.appendChild(detail);

  return row;
}

function renderWorkers(): void {
  if (!_workersScrollEl) return;
  const frag = document.createDocumentFragment();

  for (const w of getWorkerHealth()) frag.appendChild(buildWorkerRow(w));

  const runs = getWorkerRuns();
  const sub = document.createElement('div');
  sub.className = 'px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-zinc-600';
  sub.textContent = `Recent geometry runs · ${runs.length}`;
  frag.appendChild(sub);

  if (runs.length === 0) {
    const none = document.createElement('div');
    none.className = 'px-3 py-1 text-[10px] text-zinc-600 italic';
    none.textContent = 'No geometry runs recorded this session.';
    frag.appendChild(none);
  } else {
    for (const run of runs) frag.appendChild(buildRunRow(run));
  }

  _workersScrollEl.replaceChildren(frag);
}

// ── Diagnostic log (lower half) ──────────────────────────────────────────────

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
  const LEVEL_STYLE: Record<ErrorLevel, string> = {
    error: 'text-red-400',
    warn: 'text-amber-400',
    info: 'text-sky-400',
  };
  const LEVEL_LABEL: Record<ErrorLevel, string> = {
    error: '● ERR',
    warn: '● WARN',
    info: '● INFO',
  };
  levelEl.className = `text-[9px] font-bold tracking-wider shrink-0 ${LEVEL_STYLE[entry.level]}`;
  levelEl.textContent = LEVEL_LABEL[entry.level];
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

// ── Panel assembly ───────────────────────────────────────────────────────────

/** Small bordered header button shared by the section sub-headers. */
function sectionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className =
    'text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'diagnostics-panel';
  panel.className = [
    'hidden fixed bottom-0 left-0 right-0',
    'md:left-auto md:right-4 md:bottom-4 md:w-[480px] md:rounded-xl',
    'h-[480px] bg-zinc-900 border border-zinc-700 shadow-2xl flex flex-col z-[45]',
  ].join(' ');

  // ── Panel header (title + close) ──
  const header = document.createElement('div');
  header.className =
    'flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0';

  const titleEl = document.createElement('span');
  titleEl.className = 'text-xs font-semibold text-zinc-300 shrink-0';
  titleEl.textContent = 'Diagnostics';
  header.appendChild(titleEl);

  const headerSpacer = document.createElement('div');
  headerSpacer.className = 'flex-1';
  header.appendChild(headerSpacer);

  const closeBtn = document.createElement('button');
  closeBtn.className =
    'flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors text-base leading-none';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', toggleDiagnosticsPanel);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // ── Upper half — Workers ──
  const workersSection = document.createElement('div');
  workersSection.className = 'flex flex-col flex-1 min-h-0 border-b border-zinc-700';

  const wSub = document.createElement('div');
  wSub.className = 'flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0';
  const wTitle = document.createElement('span');
  wTitle.className = 'text-[10px] font-semibold uppercase tracking-wider text-zinc-500';
  wTitle.textContent = 'Workers';
  wSub.appendChild(wTitle);
  const wSpacer = document.createElement('div');
  wSpacer.className = 'flex-1';
  wSub.appendChild(wSpacer);
  wSub.appendChild(sectionButton('Clear runs', 'Clear the geometry run history (restart counts are kept)', () => clearWorkerRuns()));
  workersSection.appendChild(wSub);

  _workersScrollEl = document.createElement('div');
  _workersScrollEl.className = 'flex-1 overflow-y-auto';
  workersSection.appendChild(_workersScrollEl);

  panel.appendChild(workersSection);

  // ── Lower half — Diagnostic log ──
  const logSection = document.createElement('div');
  logSection.className = 'flex flex-col flex-1 min-h-0';

  const lSub = document.createElement('div');
  lSub.className = 'flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0';
  const lTitle = document.createElement('span');
  lTitle.className = 'text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0';
  lTitle.textContent = 'Log';
  lSub.appendChild(lTitle);

  const filterGroup = document.createElement('div');
  filterGroup.className = 'flex items-center gap-1 ml-1';
  filterGroup.appendChild(makeFilterChip('All', 'all'));
  filterGroup.appendChild(makeFilterChip('Errors', 'error'));
  filterGroup.appendChild(makeFilterChip('Warnings', 'warn'));
  filterGroup.appendChild(makeFilterChip('Info', 'info'));
  lSub.appendChild(filterGroup);
  syncFilterChips();

  const lSpacer = document.createElement('div');
  lSpacer.className = 'flex-1';
  lSub.appendChild(lSpacer);

  const copyBtn = sectionButton('Copy', 'Copy log to clipboard', () => {
    const text = errorLog
      .getEntries()
      .map(
        (e) =>
          `[${formatTime(e.timestamp)}] ${e.level.toUpperCase()} (${e.source}) ${e.message}${e.detail ? '\n' + e.detail : ''}`,
      )
      .join('\n---\n');
    void navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });
  lSub.appendChild(copyBtn);

  const clearBtn = sectionButton('Clear', 'Clear all log entries', () => errorLog.clear());
  lSub.appendChild(clearBtn);

  logSection.appendChild(lSub);

  _listEl = document.createElement('div');
  _listEl.className = 'flex-1 overflow-y-auto';
  logSection.appendChild(_listEl);

  panel.appendChild(logSection);

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
      // entries.length === 0 means the log was cleared. Otherwise the newest
      // entry sits at index 0 (capture unshifts). Only errors/warnings count
      // toward the unseen-error badge — routine 'info' activity (save/export
      // toasts) is logged for the record but must not nag the ⚠ button.
      if (entries.length === 0) {
        _unseenCount = 0;
      } else if (entries[0] && entries[0].level !== 'info') {
        _unseenCount++;
      }
      setDiagnosticsToolbarBadge(_unseenCount);
    } else {
      renderEntries(entries);
    }
  });

  // Re-render the worker half on any health/run change while the panel's open.
  onWorkerStatsChange(() => {
    if (_isOpen) renderWorkers();
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
    renderWorkers();
    // Poll for live worker values (in-flight, liveness) that change silently.
    if (_pollTimer === null) {
      _pollTimer = window.setInterval(() => {
        if (_isOpen) renderWorkers();
      }, getConfig().ui.workerPanelRefreshMs);
    }
  } else if (_pollTimer !== null) {
    window.clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
