// AI Diagnostics modal. Shows the in-memory ring buffer of recent
// provider events with full error messages. The only place to see why
// "ended (unknown)" really happened.

import {
  clearEvents,
  listEvents,
  onEventsChange,
  type DiagnosticEvent,
} from '../ai/diagnostics';
import { providerLabel } from '../ai/settings';
import { createModalShell } from './modalShell';

export function showAiDiagnosticsModal(): void {
  const shell = createModalShell({ title: 'AI Call Log', maxWidth: '2xl', scrollable: true });
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-3');

  // Wrap the shell's close to tear down our listener so reopening the
  // modal doesn't leak a fresh subscriber every time (and so stale
  // subscribers don't keep firing render() against a removed DOM tree).
  const origClose = shell.close;
  let unsubscribe: () => void = () => {};
  shell.close = () => { unsubscribe(); origClose(); };

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.textContent = 'Most recent AI provider calls, newest first. Use this when a turn ends with an opaque status like "ended (unknown)" — the full error and the request shape land here.';
  shell.body.appendChild(intro);

  const toolbar = document.createElement('div');
  toolbar.className = 'flex items-center justify-between gap-2 border-b border-zinc-800 pb-2';
  const stats = document.createElement('span');
  stats.className = 'text-xs text-zinc-500';
  toolbar.appendChild(stats);

  const right = document.createElement('div');
  right.className = 'flex items-center gap-2';
  const filterSel = document.createElement('select');
  filterSel.className = 'px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100';
  for (const [val, label] of [['all', 'All events'], ['error', 'Errors only'], ['ok', 'Successes only']]) {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    filterSel.appendChild(o);
  }
  filterSel.addEventListener('change', () => render());
  right.appendChild(filterSel);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'px-2 py-1 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.title = 'Copy the filtered events to your clipboard as JSON for sharing in a bug report.';
  copyBtn.addEventListener('click', () => {
    const visible = filteredEvents();
    const json = JSON.stringify(visible, null, 2);
    void navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1500);
    });
  });
  right.appendChild(copyBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-2 py-1 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all diagnostics events?')) return;
    clearEvents();
  });
  right.appendChild(clearBtn);

  toolbar.appendChild(right);
  shell.body.appendChild(toolbar);

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  shell.body.appendChild(list);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  closeBtn.textContent = 'Done';
  closeBtn.addEventListener('click', shell.close);
  shell.footer.appendChild(closeBtn);

  function filteredEvents(): DiagnosticEvent[] {
    const all = listEvents();
    const f = filterSel.value;
    if (f === 'error') return all.filter(e => e.status === 'error');
    if (f === 'ok') return all.filter(e => e.status === 'ok');
    return all;
  }

  function render() {
    const visible = filteredEvents();
    const all = listEvents();
    const errorCount = all.filter(e => e.status === 'error').length;
    stats.textContent = `${all.length} event(s) · ${errorCount} error(s) · showing ${visible.length}`;
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-zinc-500 text-xs italic';
      empty.textContent = all.length === 0
        ? 'No AI calls have been made this session.'
        : 'No events match the current filter.';
      list.appendChild(empty);
      return;
    }
    for (const evt of visible) {
      list.appendChild(renderEvent(evt));
    }
  }

  unsubscribe = onEventsChange(render);
  render();
}

function renderEvent(evt: DiagnosticEvent): HTMLElement {
  const wrap = document.createElement('details');
  const errBorder = evt.status === 'error' ? 'border-red-700/60' : evt.status === 'aborted' ? 'border-amber-700/60' : 'border-zinc-700';
  wrap.className = `rounded border ${errBorder} bg-zinc-900/40 overflow-hidden`;
  // Auto-open errors so the user doesn't have to click to see what failed.
  if (evt.status === 'error') wrap.open = true;

  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer px-3 py-2 flex items-center justify-between gap-2';

  const left = document.createElement('div');
  left.className = 'flex items-center gap-2 min-w-0';
  const statusDot = document.createElement('span');
  statusDot.className = `inline-block w-2 h-2 rounded-full ${
    evt.status === 'error' ? 'bg-red-400'
      : evt.status === 'aborted' ? 'bg-amber-400'
      : 'bg-emerald-400'}`;
  left.appendChild(statusDot);

  const head = document.createElement('div');
  head.className = 'flex flex-col min-w-0';
  const topLine = document.createElement('div');
  topLine.className = 'text-sm text-zinc-100 font-mono truncate';
  topLine.textContent = `${providerLabel(evt.provider)} · ${evt.model} · ${evt.kind}`;
  head.appendChild(topLine);
  const subLine = document.createElement('div');
  subLine.className = 'text-[10px] text-zinc-500 truncate';
  const subParts: string[] = [];
  subParts.push(new Date(evt.timestamp).toLocaleTimeString());
  subParts.push(`${evt.durationMs}ms`);
  if (evt.status === 'ok') {
    if (evt.stopReason) subParts.push(`stop: ${evt.stopReason}`);
    if (typeof evt.outputTokens === 'number') subParts.push(`${evt.outputTokens}t out`);
    if (evt.toolCallCount) subParts.push(`${evt.toolCallCount} tool call(s)`);
  } else if (evt.status === 'error') {
    subParts.push(truncate(evt.errorMessage ?? 'error', 80));
  } else if (evt.status === 'aborted') {
    subParts.push('aborted');
  }
  subLine.textContent = subParts.join(' · ');
  head.appendChild(subLine);
  left.appendChild(head);
  summary.appendChild(left);

  const statusBadge = document.createElement('span');
  statusBadge.className = `shrink-0 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${
    evt.status === 'error' ? 'bg-red-900/40 text-red-200 border border-red-700/40'
      : evt.status === 'aborted' ? 'bg-amber-900/40 text-amber-200 border border-amber-700/40'
      : 'bg-emerald-900/30 text-emerald-200 border border-emerald-700/40'}`;
  statusBadge.textContent = evt.status;
  summary.appendChild(statusBadge);

  wrap.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'px-3 pb-3 pt-1 border-t border-zinc-800 text-[11px] text-zinc-300 flex flex-col gap-2';

  if (evt.requestSummary) body.appendChild(kv('Request', evt.requestSummary));
  if (evt.status === 'error' && evt.errorMessage) body.appendChild(kvBlock('Error', evt.errorMessage, 'text-red-200'));
  if (evt.status === 'ok') {
    if (evt.stopReason) body.appendChild(kv('Stop reason', evt.stopReason));
    if (typeof evt.inputTokens === 'number') body.appendChild(kv('Tokens', `${evt.inputTokens} in · ${evt.outputTokens ?? 0} out${evt.cachedTokens ? ` · ${evt.cachedTokens} cached` : ''}`));
    if (evt.textPreview && evt.textPreview.length > 0) body.appendChild(kvBlock('Text preview', evt.textPreview));
  }
  if (evt.notes) body.appendChild(kv('Notes', evt.notes));

  wrap.appendChild(body);
  return wrap;
}

function kv(label: string, value: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-baseline gap-2';
  const l = document.createElement('span');
  l.className = 'text-zinc-500 shrink-0 w-20';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'text-zinc-200 font-mono break-all';
  v.textContent = value;
  wrap.appendChild(l); wrap.appendChild(v);
  return wrap;
}

function kvBlock(label: string, value: string, extraClass = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-1';
  const l = document.createElement('span');
  l.className = 'text-zinc-500 text-[10px] uppercase tracking-wider';
  l.textContent = label;
  const v = document.createElement('pre');
  v.className = `text-[11px] font-mono whitespace-pre-wrap break-words rounded bg-zinc-950/60 border border-zinc-800 px-2 py-1.5 ${extraClass}`;
  v.textContent = value;
  wrap.appendChild(l); wrap.appendChild(v);
  return wrap;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
