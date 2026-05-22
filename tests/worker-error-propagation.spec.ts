// Tests that errors thrown inside the geometry Web Worker are propagated to
// the main thread and surfaced in the UI — not silently dropped or hung.
//
// The Worker architecture (engineWorker.ts) returns execute_result with
// error: string when user code doesn't return a Manifold, and an `error`
// type message when the Worker itself throws. Both paths must end up in
// the geometry-data element with status: 'error' and a non-empty error
// string so AI agents can diagnose failures.

import { test, expect } from 'playwright/test';

// Shared type used across evaluations.
type GeometryData = {
  status?: string;
  error?: string;
  triangleCount?: number;
};

type PartwrightApi = {
  run: (code: string) => Promise<GeometryData>;
  getGeometryData: () => GeometryData;
  getBoundingBox: () => { min: number[]; max: number[] } | null;
  sliceAtZ: (z: number) => unknown;
};

test.describe('Worker error propagation', () => {
  test('code that throws surfaces an error in geometry data', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15_000 });

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      // Code that throws a runtime error — should NOT silently hang.
      return pw.run('throw new Error("intentional test error");');
    });

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/intentional test error/i);
  });

  test('code that returns nothing (undefined) surfaces the missing-return error', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15_000 });

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      // Code that forgets to return a Manifold.
      return pw.run('const { Manifold } = api; const c = Manifold.cube([5, 5, 5]);');
    });

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    // App surfaces a "must return a Manifold" style diagnostic.
    expect(result.error).toMatch(/return|Manifold/i);
  });

  test('code that returns a plain object instead of a Manifold surfaces an error', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15_000 });

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      return pw.run('return { notAManifold: true };');
    });

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  });

  test('status bar shows error state (not stuck on loading) after bad code', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15_000 });

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      await pw.run('throw new Error("status bar test");');
    });

    // The status indicator must NOT remain "Loading" — it must flip to an
    // error state. The app renders a coloured status badge in the toolbar.
    // "Ready" disappears; either an error text appears or the badge text
    // changes. We check via the geometry-data element (machine-readable).
    const geoData = await page.evaluate(() => {
      const el = document.getElementById('geometry-data');
      return el ? JSON.parse(el.textContent || '{}') : null;
    });

    expect(geoData).not.toBeNull();
    expect(geoData.status).toBe('error');
  });

  test('error clears after a successful run (no stuck error state)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15_000 });

    // First run bad code to put the engine in error state.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      await pw.run('throw new Error("transient error");');
    });

    // Then run valid code — should succeed and clear the error.
    const successResult = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      return pw.run('return api.Manifold.cube([5, 5, 5]);');
    });

    expect(successResult.status).toBe('ok');
    expect(successResult.error).toBeUndefined();
    expect(successResult.triangleCount).toBeGreaterThan(0);
  });
});
