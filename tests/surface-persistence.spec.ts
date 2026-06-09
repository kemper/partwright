// Phase 3 — persistence of computed api.surface.* textures across the in-memory
// cache being lost (e.g. a reload). A computed texture is written to a
// content-addressed IndexedDB store (src/storage/surfaceCacheStore.ts); when the
// in-memory memo cache is empty, an explicit run seeds from IndexedDB and
// renders the textured mesh WITHOUT recomputing. Proven via the compute counter:
// the second run's count is unchanged.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test('a computed surface texture persists and is reused without recompute', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/editor');
  await waitForEngine(page);

  const code = [
    'const { Manifold } = api;',
    'api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });',
    'return Manifold.sphere(10, 48);',
  ].join('\n');

  // First explicit run: computes the texture and persists it.
  const first = await page.evaluate(async (src) => {
    const pw = (window as unknown as { partwright: { createSession: (n?: string) => Promise<unknown>; run: (c: string) => Promise<{ triangleCount?: number }> } }).partwright;
    await pw.createSession('surface-persist');
    const ops = await import('/src/surface/surfaceOps.ts');
    const r = await pw.run(src);
    return { tris: r.triangleCount ?? 0, computeCalls: ops.__surfaceComputeCalls() };
  }, code);
  expect(first.tris).toBeGreaterThan(0);
  expect(first.computeCalls).toBeGreaterThan(0); // it actually computed

  // Wait for the (fire-and-forget) persistent write to land.
  await page.waitForFunction(async () => {
    const store = await import('/src/storage/surfaceCacheStore.ts');
    return (await store.surfaceCacheCount()) > 0;
  }, { timeout: 10_000 });

  // Drop the in-memory cache (simulates a reload), then run the SAME code again.
  const second = await page.evaluate(async (src) => {
    const ops = await import('/src/surface/surfaceOps.ts');
    ops.__clearSurfaceCache();
    const before = ops.__surfaceComputeCalls();
    const pw = (window as unknown as { partwright: { run: (c: string) => Promise<{ triangleCount?: number }> } }).partwright;
    const r = await pw.run(src);
    return { tris: r.triangleCount ?? 0, delta: ops.__surfaceComputeCalls() - before };
  }, code);

  // Still textured (same triangle count) ...
  expect(second.tris).toBe(first.tris);
  // ... but served from the persistent store — zero new compute.
  expect(second.delta).toBe(0);
  // No "Re-apply" pill: the explicit run applied the (persisted) texture.
  await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
});
