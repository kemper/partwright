import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWorker,
  markWorkerStarted,
  markWorkerRestarted,
  markWorkerStopped,
  recordWorkerRun,
  getWorkerHealth,
  getWorkerRuns,
  clearWorkerRuns,
  onWorkerStatsChange,
  _resetWorkerStatsForTest,
} from '../../src/diagnostics/workerStats';

function health(id: string) {
  return getWorkerHealth().find(w => w.id === id);
}

describe('workerStats', () => {
  beforeEach(() => {
    _resetWorkerStatsForTest();
  });

  it('pre-registers the four known workers as idle with zero counts', () => {
    const ids = getWorkerHealth().map(w => w.id).sort();
    expect(ids).toEqual(['agent', 'geometry', 'subdivision', 'webllm']);
    for (const w of getWorkerHealth()) {
      expect(w.alive).toBe(false);
      expect(w.startCount).toBe(0);
      expect(w.restartCount).toBe(0);
      expect(w.inFlight).toBe(0);
    }
  });

  it('markWorkerStarted increments startCount and flips alive', () => {
    markWorkerStarted('geometry');
    expect(health('geometry')?.startCount).toBe(1);
    expect(health('geometry')?.alive).toBe(true);
    markWorkerStarted('geometry');
    expect(health('geometry')?.startCount).toBe(2);
  });

  it('markWorkerRestarted records reason, bumps restartCount, and marks not-alive', () => {
    markWorkerStarted('geometry');
    markWorkerRestarted('geometry', 'timed out after 60s');
    const w = health('geometry')!;
    expect(w.restartCount).toBe(1);
    expect(w.alive).toBe(false);
    expect(w.lastRestartReason).toBe('timed out after 60s');
    expect(typeof w.lastRestartAt).toBe('number');
  });

  it('markWorkerStopped clears alive without counting a restart', () => {
    markWorkerStarted('agent');
    markWorkerStopped('agent');
    expect(health('agent')?.alive).toBe(false);
    expect(health('agent')?.restartCount).toBe(0);
  });

  it('a live provider overrides stored alive/inFlight on read', () => {
    let alive = true;
    let inFlight = 3;
    registerWorker('geometry', 'Geometry', () => ({ alive, inFlight }));
    expect(health('geometry')?.alive).toBe(true);
    expect(health('geometry')?.inFlight).toBe(3);
    alive = false;
    inFlight = 0;
    expect(health('geometry')?.alive).toBe(false);
    expect(health('geometry')?.inFlight).toBe(0);
  });

  it('re-registering keeps accumulated counts (idempotent)', () => {
    markWorkerStarted('subdivision');
    markWorkerRestarted('subdivision', 'crash');
    registerWorker('subdivision', 'Paint subdivision', () => ({ alive: true, inFlight: 1 }));
    const w = health('subdivision')!;
    expect(w.startCount).toBe(1);
    expect(w.restartCount).toBe(1);
    expect(w.alive).toBe(true);
    expect(w.inFlight).toBe(1);
  });

  it('records runs newest-first and evicts beyond the ring size', () => {
    // Default ring size is 50 (worker context → config defaults).
    for (let i = 0; i < 55; i++) {
      recordWorkerRun({ worker: 'geometry', kind: 'manifold-js', durationMs: i, status: 'ok' });
    }
    const runs = getWorkerRuns();
    expect(runs.length).toBe(50);
    // Newest first: the last recorded (durationMs 54) is at index 0.
    expect(runs[0].durationMs).toBe(54);
    expect(runs[0].id).toBeTruthy();
    expect(typeof runs[0].timestamp).toBe('number');
  });

  it('clearWorkerRuns empties history but keeps worker health', () => {
    markWorkerStarted('geometry');
    recordWorkerRun({ worker: 'geometry', kind: 'scad', durationMs: 10, status: 'error', detail: 'boom' });
    expect(getWorkerRuns().length).toBe(1);
    clearWorkerRuns();
    expect(getWorkerRuns().length).toBe(0);
    expect(health('geometry')?.startCount).toBe(1);
  });

  it('notifies subscribers on start, restart, run, and clear', () => {
    let calls = 0;
    const unsub = onWorkerStatsChange(() => { calls++; });
    markWorkerStarted('geometry');
    markWorkerRestarted('geometry', 'x');
    recordWorkerRun({ worker: 'geometry', kind: 'voxel', durationMs: 1, status: 'ok' });
    clearWorkerRuns();
    expect(calls).toBe(4);
    unsub();
    markWorkerStarted('geometry');
    expect(calls).toBe(4); // no further notifications after unsubscribe
  });

  it('preserves workerMs and detail on recorded runs', () => {
    recordWorkerRun({ worker: 'geometry', kind: 'manifold-js', durationMs: 120, workerMs: 95, status: 'ok' });
    const run = getWorkerRuns()[0];
    expect(run.durationMs).toBe(120);
    expect(run.workerMs).toBe(95);
    expect(run.status).toBe('ok');
  });
});
