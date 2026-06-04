// Worker health registry. A single, UI-agnostic source of truth for the
// state of the app's Web Workers — whether each is alive, how many ops are in
// flight, how often it has been (re)started, and a ring buffer of recent
// geometry runs with their wall-clock + worker-side timings.
//
// This is a leaf module (it imports only the config, never a feature layer),
// so any worker client can record into it without creating a dependency cycle.
// The worker-health panel (src/ui/workerDiagnosticsModal.tsx) is a pure
// consumer; it never writes here.
//
// Why this exists: the geometry Worker silently terminates + respawns on a
// timeout or crash (see restartEngineWorker in src/geometry/engine.ts). Before
// this registry there was no way to see that your worker had died and come
// back — the signature of an out-of-memory crash loop on a heavy model.

import { getConfig } from '../config/appConfig';

export type WorkerId = 'geometry' | 'agent' | 'subdivision' | 'webllm';

/** Snapshot of the volatile, moment-to-moment state of a worker. Supplied by
 *  an optional live provider so the panel reflects reality on each poll
 *  without the client having to push an update on every map mutation. */
export interface WorkerLiveState {
  /** Whether the worker instance currently exists (booted, not torn down). */
  alive: boolean;
  /** Operations currently awaiting a result from this worker. */
  inFlight: number;
}

export interface WorkerHealth {
  id: WorkerId;
  label: string;
  alive: boolean;
  inFlight: number;
  /** Times this worker was created since page load (initial boot counts as 1). */
  startCount: number;
  /** Times it was torn down unexpectedly (crash / timeout / forced restart /
   *  user cancel). A climbing count on a single session is the tell-tale of a
   *  crash loop. */
  restartCount: number;
  /** Reason string for the most recent restart, if any. */
  lastRestartReason?: string;
  /** When the most recent restart happened (epoch ms). */
  lastRestartAt?: number;
}

export type RunStatus = 'ok' | 'error' | 'timeout' | 'cancelled';

export interface WorkerRun {
  id: string;
  timestamp: number;
  worker: WorkerId;
  /** Operation label — the language ('manifold-js', 'scad', …) or op name. */
  kind: string;
  /** Wall-clock ms measured on the main thread (post → settle). Includes
   *  queueing and structured-clone transfer overhead. */
  durationMs: number;
  /** Compute ms measured inside the worker, when the worker reports it
   *  (excludes queue + transfer overhead). The gap between this and
   *  durationMs is the transport cost. */
  workerMs?: number;
  status: RunStatus;
  /** Short error/detail snippet for failures. */
  detail?: string;
}

interface WorkerEntry {
  health: WorkerHealth;
  live?: () => WorkerLiveState;
}

const workers = new Map<WorkerId, WorkerEntry>();
const runs: WorkerRun[] = [];
const listeners = new Set<() => void>();
let runCounter = 0;

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken listener must not break recording */ }
  }
}

/** Register a worker so it appears in the panel. Idempotent: a second call
 *  with the same id updates the label / live provider without resetting the
 *  accumulated counts. Clients call this once at module load. */
export function registerWorker(
  id: WorkerId,
  label: string,
  live?: () => WorkerLiveState,
): void {
  const existing = workers.get(id);
  if (existing) {
    existing.health.label = label;
    if (live) existing.live = live;
    return;
  }
  workers.set(id, {
    health: { id, label, alive: false, inFlight: 0, startCount: 0, restartCount: 0 },
    live,
  });
}

/** Record that a worker instance was just created (initial boot or respawn). */
export function markWorkerStarted(id: WorkerId): void {
  const e = workers.get(id);
  if (!e) return;
  e.health.startCount += 1;
  e.health.alive = true;
  notify();
}

/** Record that a worker was torn down unexpectedly (crash / timeout / forced
 *  restart / cancel). The reason is surfaced verbatim in the panel. */
export function markWorkerRestarted(id: WorkerId, reason: string): void {
  const e = workers.get(id);
  if (!e) return;
  e.health.restartCount += 1;
  e.health.lastRestartReason = reason;
  e.health.lastRestartAt = Date.now();
  e.health.alive = false;
  notify();
}

/** Record a clean stop (no error) — the worker is no longer alive but this is
 *  not counted as a restart. */
export function markWorkerStopped(id: WorkerId): void {
  const e = workers.get(id);
  if (!e) return;
  e.health.alive = false;
  notify();
}

/** Push a completed run into the ring buffer (newest first). */
export function recordWorkerRun(run: Omit<WorkerRun, 'id' | 'timestamp'>): void {
  runCounter += 1;
  const full: WorkerRun = {
    id: `run-${Date.now().toString(36)}-${runCounter.toString(36)}`,
    timestamp: Date.now(),
    ...run,
  };
  runs.unshift(full);
  const max = getConfig().ui.workerRunHistorySize;
  if (runs.length > max) runs.length = max;
  notify();
}

/** Snapshot of every registered worker's current health. Live providers (if
 *  registered) override the stored `alive` / `inFlight` so the values reflect
 *  the moment of the call rather than the last pushed update. */
export function getWorkerHealth(): WorkerHealth[] {
  return [...workers.values()].map((e) => {
    const live = e.live?.();
    return {
      ...e.health,
      alive: live ? live.alive : e.health.alive,
      inFlight: live ? live.inFlight : e.health.inFlight,
    };
  });
}

/** Snapshot of recent runs, newest first. Returns a copy. */
export function getWorkerRuns(): WorkerRun[] {
  return runs.slice();
}

export function clearWorkerRuns(): void {
  runs.length = 0;
  notify();
}

/** Subscribe to any health/run change. Returns an unsubscribe fn. Note: live
 *  provider values (in-flight counts) change without firing this, so the panel
 *  also polls on an interval — see workerDiagnosticsModal. */
export function onWorkerStatsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test-only: wipe all registered workers and runs back to a clean slate. */
export function _resetWorkerStatsForTest(): void {
  workers.clear();
  runs.length = 0;
  runCounter = 0;
  listeners.clear();
  registerKnownWorkers();
}

/** Pre-register every known worker with a default label so the panel always
 *  lists all four — even the lazily-loaded ones (agent / subdivision / webllm)
 *  whose client module hasn't been imported yet. Each client calls
 *  registerWorker again on load to attach its live provider; that's idempotent
 *  and keeps the accumulated counts. A worker that hasn't started shows as
 *  not-alive with zero counts, which is itself useful ("never used this
 *  session"). */
function registerKnownWorkers(): void {
  registerWorker('geometry', 'Geometry (manifold / SCAD / BREP)');
  registerWorker('agent', 'AI agent (chat loop)');
  registerWorker('subdivision', 'Paint subdivision');
  registerWorker('webllm', 'Local model (WebLLM)');
}

registerKnownWorkers();
