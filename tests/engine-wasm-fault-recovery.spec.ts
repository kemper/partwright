import { test, expect } from 'playwright/test';

// Regression: a fatal WASM kernel fault (e.g. "memory access out of bounds" from
// a model too large for the heap) must NOT poison the geometry Worker. Before the
// fix, the trap left the manifold-3d module in a half-mutated state and every
// subsequent run — even a trivial cube — failed instantly with the same error
// until the page was reloaded. The engine now recycles the Worker after such a
// fault, so the next run boots a clean module and succeeds.
test.describe('engine WASM fault recovery', () => {
  test('fatal memory fault recovers on the next run', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { runIsolated?: unknown } }).partwright?.runIsolated,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(3000); // let WASM boot

    const run = (code: string) =>
      page.evaluate(
        async (c) => (await (window as any).partwright.runIsolated(c)).geometryData, // eslint-disable-line @typescript-eslint/no-explicit-any
        code,
      );

    const cube = 'return api.Manifold.cube([10,10,10], true);';

    // 1) Baseline: a normal model runs fine.
    expect((await run(cube)).status).toBe('ok');

    // 2) Force a WASM memory fault: an absurd circular-segment count makes the
    //    kernel try to allocate billions of vertices, tripping the heap ceiling.
    const fault = await run('return api.Manifold.sphere(10, 100000);');
    expect(fault.status).toBe('error');
    // The opaque trap text is replaced with an actionable, memory-aware hint.
    expect(fault.error).toMatch(/ran out of memory/i);

    // 3) Recovery: the same baseline model must run again. Pre-fix this failed
    //    instantly with the same memory error (the poisoned-worker cascade).
    expect((await run(cube)).status).toBe('ok');
  });
});
