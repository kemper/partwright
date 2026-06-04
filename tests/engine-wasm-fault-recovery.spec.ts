import { test, expect } from 'playwright/test';

// Regression: a fatal WASM kernel fault (e.g. "memory access out of bounds" when
// a model exceeds the manifold-3d heap, which only grows) must NOT poison the
// long-lived geometry Worker. Before the fix the trap left the kernel's C++
// state half-mutated, so every subsequent run — even a trivial cube — failed
// instantly with the same error until the page was reloaded. The engine now
// recognises the fatal fault and recycles the Worker so the next run boots a
// clean module.
//
// Why we *simulate* the trap rather than really exhausting the heap: a genuine
// OOM is a CPU grind whose timing depends on the host's memory ceiling (it
// trapped in ~0.1 s on a constrained sandbox but ran past 30 s on a roomier CI
// runner). Throwing the kernel's exact message string from sandbox code flows
// through the identical path — caught in the engine's run() try/catch, returned
// as an `execute_result` error, classified by isFatalWasmFault, and recycled —
// so this faithfully and deterministically exercises the recovery wiring.
test.describe('engine WASM fault recovery', () => {
  test('a fatal WASM fault is classified, recycles the Worker, and recovers', async ({ page }) => {
    const recycleLogs: string[] = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Recycling geometry Worker after fatal WASM fault/i.test(t)) recycleLogs.push(t);
    });

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

    // 2) A fatal WASM-memory fault surfaces as an error with the actionable,
    //    memory-aware hint (instead of the raw, opaque trap text).
    const fault = await run("throw new Error('memory access out of bounds');");
    expect(fault.status).toBe('error');
    expect(fault.error).toMatch(/ran out of memory/i);

    // 3) The engine must have recycled the poisoned Worker. This log fires only
    //    when the recovery wiring runs — it is absent on pre-fix code.
    await expect.poll(() => recycleLogs.length, { timeout: 5000 }).toBeGreaterThan(0);

    // 4) Recovery: the same baseline model runs again on the fresh module.
    expect((await run(cube)).status).toBe('ok');
  });
});
