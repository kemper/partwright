import { afterEach, describe, expect, it, vi } from 'vitest';

// With the engine sandbox unavailable (fail-closed), every Worker the pool asks
// for is a stand-in that errors with "engine sandbox unavailable: …". The pool
// must surface that message on every queued build — not burn its respawn
// budget and report a generic "failed to initialise".

const REFUSAL = 'engine sandbox unavailable: the sandbox frame did not load in time';
let spawned = 0;

vi.mock('../../src/sandbox/sandboxHost', () => ({
  isEngineSandboxUnavailableError: (m: string) => m.includes('engine sandbox unavailable'),
  createEngineWorker: () => {
    spawned++;
    const h = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      onerror: null as ((ev: { message: string }) => void) | null,
      onmessageerror: null,
      fired: false,
      postMessage() {
        if (h.fired) return;
        h.fired = true;
        queueMicrotask(() => h.onerror?.({ message: REFUSAL }));
      },
      terminate() { /* no-op */ },
    };
    return h;
  },
}));

describe('engine pool with the sandbox unavailable', () => {
  afterEach(async () => {
    const { disposeEnginePool } = await import('../../src/geometry/enginePool');
    disposeEnginePool();
  });

  it('rejects every build with the sandbox refusal and does not respawn', async () => {
    const { buildInPool, setEnginePoolSize } = await import('../../src/geometry/enginePool');
    setEnginePoolSize(2);
    const builds = [0, 1, 2, 3].map(i => buildInPool({ code: `return ${i};`, lang: 'manifold-js' }));
    const results = await Promise.allSettled(builds);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason.message).toContain('engine sandbox unavailable');
    }
    // One Worker per pool slot at most — no respawn loop.
    expect(spawned).toBeLessThanOrEqual(2);
  });
});
