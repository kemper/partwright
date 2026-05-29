// AI Diagnostics modal. In-memory ring buffer of recent provider events
// with full error messages — the only place to see why "ended (unknown)"
// really happened.
//
// Note: the original hand-wrapped `shell.close` so the diagnostics event
// subscription wouldn't leak across reopens. With Preact's `useEffect`
// cleanup that's automatic — see the `onEventsChange` subscription below.

import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import {
  clearEvents,
  listEvents,
  onEventsChange,
  type DiagnosticEvent,
} from '../ai/diagnostics';
import { providerLabel } from '../ai/settings';
import { mountPreactModal } from './preact/mount';

type FilterMode = 'all' | 'error' | 'ok';

function filterEvents(events: DiagnosticEvent[], mode: FilterMode): DiagnosticEvent[] {
  if (mode === 'error') return events.filter(e => e.status === 'error');
  if (mode === 'ok') return events.filter(e => e.status === 'ok');
  return events;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function DiagnosticsBody() {
  const events = useSignal<DiagnosticEvent[]>(listEvents());
  const filter = useSignal<FilterMode>('all');
  const copyLabel = useSignal('Copy JSON');

  useEffect(() => {
    const unsubscribe = onEventsChange(() => { events.value = listEvents(); });
    return () => { unsubscribe(); };
  }, []);

  const visible = filterEvents(events.value, filter.value);
  const errorCount = events.value.filter(e => e.status === 'error').length;
  const statsText = `${events.value.length} event(s) · ${errorCount} error(s) · showing ${visible.length}`;

  return (
    <>
      <p class="text-xs text-zinc-400 leading-snug">
        Most recent AI provider calls, newest first. Use this when a turn ends with an opaque status like "ended (unknown)" — the full error and the request shape land here.
      </p>
      <div class="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <span class="text-xs text-zinc-500">{statsText}</span>
        <div class="flex items-center gap-2">
          <select
            class="px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100"
            value={filter.value}
            onChange={e => { filter.value = (e.currentTarget as HTMLSelectElement).value as FilterMode; }}
          >
            <option value="all">All events</option>
            <option value="error">Errors only</option>
            <option value="ok">Successes only</option>
          </select>
          <button
            type="button"
            class="px-2 py-1 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600"
            title="Copy the filtered events to your clipboard as JSON for sharing in a bug report."
            onClick={() => {
              const json = JSON.stringify(visible, null, 2);
              void navigator.clipboard.writeText(json).then(() => {
                copyLabel.value = 'Copied!';
                setTimeout(() => { copyLabel.value = 'Copy JSON'; }, 1500);
              });
            }}
          >{copyLabel.value}</button>
          <button
            type="button"
            class="px-2 py-1 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60"
            onClick={() => {
              if (!confirm('Clear all diagnostics events?')) return;
              clearEvents();
            }}
          >Clear</button>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        {visible.length === 0
          ? <p class="text-zinc-500 text-xs italic">
              {events.value.length === 0
                ? 'No AI calls have been made this session.'
                : 'No events match the current filter.'}
            </p>
          : visible.map(evt => <EventRow key={`${evt.timestamp}:${evt.kind}`} evt={evt} />)}
      </div>
    </>
  );
}

function EventRow(props: { evt: DiagnosticEvent }) {
  const { evt } = props;
  const errBorder = evt.status === 'error'
    ? 'border-red-700/60'
    : evt.status === 'aborted'
      ? 'border-amber-700/60'
      : 'border-zinc-700';
  const dotColor = evt.status === 'error'
    ? 'bg-red-400'
    : evt.status === 'aborted'
      ? 'bg-amber-400'
      : 'bg-emerald-400';
  const badgeColor = evt.status === 'error'
    ? 'bg-red-900/40 text-red-200 border border-red-700/40'
    : evt.status === 'aborted'
      ? 'bg-amber-900/40 text-amber-200 border border-amber-700/40'
      : 'bg-emerald-900/30 text-emerald-200 border border-emerald-700/40';

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

  return (
    <details open={evt.status === 'error'} class={`rounded border ${errBorder} bg-zinc-900/40 overflow-hidden`}>
      <summary class="cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
          <div class="flex flex-col min-w-0">
            <div class="text-sm text-zinc-100 font-mono truncate">
              {providerLabel(evt.provider)} · {evt.model} · {evt.kind}
            </div>
            <div class="text-[10px] text-zinc-500 truncate">{subParts.join(' · ')}</div>
          </div>
        </div>
        <span class={`shrink-0 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${badgeColor}`}>
          {evt.status}
        </span>
      </summary>
      <div class="px-3 pb-3 pt-1 border-t border-zinc-800 text-[11px] text-zinc-300 flex flex-col gap-2">
        {evt.requestSummary && <Kv label="Request" value={evt.requestSummary} />}
        {evt.status === 'error' && evt.errorMessage && <KvBlock label="Error" value={evt.errorMessage} extraClass="text-red-200" />}
        {evt.status === 'ok' && (
          <>
            {evt.stopReason && <Kv label="Stop reason" value={evt.stopReason} />}
            {typeof evt.inputTokens === 'number' && (
              <Kv label="Tokens" value={`${evt.inputTokens} in · ${evt.outputTokens ?? 0} out${evt.cachedTokens ? ` · ${evt.cachedTokens} cached` : ''}`} />
            )}
            {evt.textPreview && evt.textPreview.length > 0 && <KvBlock label="Text preview" value={evt.textPreview} />}
          </>
        )}
        {evt.notes && <Kv label="Notes" value={evt.notes} />}
      </div>
    </details>
  );
}

function Kv(props: { label: string; value: string }) {
  return (
    <div class="flex items-baseline gap-2">
      <span class="text-zinc-500 shrink-0 w-20">{props.label}</span>
      <span class="text-zinc-200 font-mono break-all">{props.value}</span>
    </div>
  );
}

function KvBlock(props: { label: string; value: string; extraClass?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-zinc-500 text-[10px] uppercase tracking-wider">{props.label}</span>
      <pre class={`text-[11px] font-mono whitespace-pre-wrap break-words rounded bg-zinc-950/60 border border-zinc-800 px-2 py-1.5 ${props.extraClass ?? ''}`}>
        {props.value}
      </pre>
    </div>
  );
}

export function showAiDiagnosticsModal(): void {
  mountPreactModal(
    { title: 'AI Call Log', maxWidth: '2xl', scrollable: true },
    close => ({
      body: <DiagnosticsBody />,
      footer: (
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600"
          onClick={close}
        >Done</button>
      ),
    }),
  );
}
