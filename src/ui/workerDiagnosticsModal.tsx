// Worker health panel. Shows the live state of the app's Web Workers —
// liveness, in-flight load, (re)start counts with the last restart reason —
// plus a ring buffer of recent geometry runs with wall-clock vs worker-side
// timing. The data comes from the worker-stats registry
// (src/diagnostics/workerStats.ts); this view is a pure consumer.
//
// Why it's useful: a climbing restart count on the geometry worker is the
// signature of an out-of-memory crash loop on a heavy model — the failure
// mode that motivated the WASM heap tracking — and the run history shows
// whether a slow render was the boolean itself (high workerMs) or transfer
// overhead (workerMs ≪ durationMs).

import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
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
import { mountPreactModal } from './preact/mount';
import { confirmDialog } from './dialogs';
import { BUTTON_SMALL_SECONDARY, BUTTON_CANCEL } from './styleConstants';

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

const RUN_DOT: Record<RunStatus, string> = {
  ok: 'bg-emerald-400',
  error: 'bg-red-400',
  timeout: 'bg-amber-400',
  cancelled: 'bg-zinc-500',
};

function WorkerCard(props: { w: WorkerHealth }) {
  const { w } = props;
  const aliveDot = w.alive ? 'bg-emerald-400' : 'bg-zinc-600';
  const aliveText = w.alive ? 'running' : 'idle';
  // A restart count climbing within a single session is the crash-loop tell.
  const restartTone = w.restartCount === 0
    ? 'text-zinc-500'
    : w.restartCount >= 3
      ? 'text-red-300'
      : 'text-amber-300';

  return (
    <div class="rounded border border-zinc-700 bg-zinc-900/40 px-3 py-2 flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class={`inline-block w-2 h-2 rounded-full shrink-0 ${aliveDot}`} />
          <span class="text-sm text-zinc-100 truncate">{w.label}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {w.inFlight > 0 && (
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 border border-amber-700/40">
              {w.inFlight} in flight
            </span>
          )}
          <span class="text-[10px] text-zinc-500 uppercase tracking-wide">{aliveText}</span>
        </div>
      </div>
      <div class="flex items-center gap-3 text-[11px] font-mono">
        <span class="text-zinc-500">starts: <span class="text-zinc-300">{w.startCount}</span></span>
        <span class={restartTone} title={w.lastRestartReason ?? 'no restarts'}>
          restarts: {w.restartCount}
        </span>
      </div>
      {w.lastRestartReason && (
        <div class="text-[10px] text-zinc-500 break-words">
          last restart {w.lastRestartAt ? `at ${fmtTime(w.lastRestartAt)}` : ''}: <span class="text-zinc-400">{w.lastRestartReason}</span>
        </div>
      )}
    </div>
  );
}

function RunRow(props: { run: WorkerRun }) {
  const { run } = props;
  const timing = run.workerMs != null
    ? `${fmtMs(run.durationMs)} (${fmtMs(run.workerMs)} compute)`
    : fmtMs(run.durationMs);
  return (
    <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/40">
      <span class={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${RUN_DOT[run.status]}`} />
      <span class="text-[10px] text-zinc-600 font-mono shrink-0 tabular-nums">{fmtTime(run.timestamp)}</span>
      <span class="text-[11px] text-zinc-300 font-mono shrink-0">{run.kind}</span>
      <span class="text-[11px] text-zinc-500 font-mono truncate flex-1 min-w-0">
        {run.status === 'ok' ? timing : `${run.status} · ${run.detail ? run.detail : timing}`}
      </span>
      {run.status === 'ok' && <span class="text-[10px] text-zinc-600 font-mono shrink-0">{timing}</span>}
    </div>
  );
}

function WorkerDiagnosticsBody() {
  const health = useSignal<WorkerHealth[]>(getWorkerHealth());
  const runs = useSignal<WorkerRun[]>(getWorkerRuns());
  const copyLabel = useSignal('Copy JSON');

  useEffect(() => {
    const refresh = () => {
      health.value = getWorkerHealth();
      runs.value = getWorkerRuns();
    };
    // Subscribe for instant updates on restarts / new runs…
    const unsubscribe = onWorkerStatsChange(refresh);
    // …and poll so live values (in-flight counts, liveness) stay current
    // even though they change without firing a stats event.
    const timer = window.setInterval(refresh, getConfig().ui.workerPanelRefreshMs);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  return (
    <>
      <p class="text-xs text-zinc-400 leading-snug">
        Live state of the app's Web Workers. A climbing <span class="text-amber-300">restart</span> count means a worker keeps dying and respawning — usually an out-of-memory crash on a heavy model. Recent geometry runs show wall-clock time and, in parentheses, the time actually spent computing inside the worker.
      </p>

      <div class="flex flex-col gap-2">
        {health.value.map(w => <WorkerCard key={w.id} w={w} />)}
      </div>

      <div class="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2 pt-1">
        <span class="text-xs text-zinc-500">Recent geometry runs · {runs.value.length}</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class={BUTTON_SMALL_SECONDARY}
            title="Copy worker health + run history as JSON for a bug report."
            onClick={() => {
              const json = JSON.stringify({ workers: health.value, runs: runs.value }, null, 2);
              void navigator.clipboard.writeText(json).then(() => {
                copyLabel.value = 'Copied!';
                setTimeout(() => { copyLabel.value = 'Copy JSON'; }, 1500);
              });
            }}
          >{copyLabel.value}</button>
          <button
            type="button"
            class={BUTTON_SMALL_SECONDARY}
            onClick={async () => {
              if (!(await confirmDialog('Clear the run history? Worker restart counts are kept.', { title: 'Clear run history', confirmLabel: 'Clear', danger: true }))) return;
              clearWorkerRuns();
            }}
          >Clear runs</button>
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        {runs.value.length === 0
          ? <p class="text-zinc-500 text-xs italic">No geometry runs recorded this session.</p>
          : runs.value.map(run => <RunRow key={run.id} run={run} />)}
      </div>
    </>
  );
}

export function showWorkerDiagnosticsModal(): void {
  mountPreactModal(
    { title: 'Worker Health', maxWidth: '2xl', scrollable: true },
    close => ({
      body: <WorkerDiagnosticsBody />,
      footer: (
        <button type="button" class={BUTTON_CANCEL} onClick={close}>Done</button>
      ),
    }),
  );
}
