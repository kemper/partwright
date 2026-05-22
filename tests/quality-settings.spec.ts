import { test, expect } from 'playwright/test';

// Verifies the new modeling-quality settings modal + persistence wiring.
//   1. Toolbar exposes a gear button that opens the modal.
//   2. The modal defaults to "Highest" the first time it loads (clean storage).
//   3. Picking a different preset persists to localStorage and triggers a re-render.

test.describe('Modeling quality settings', () => {
  test('toolbar gear opens modal showing Highest as default', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-quality');

    await page.locator('#btn-quality').click();
    await expect(page.getByRole('heading', { name: 'Modeling Quality' })).toBeVisible();

    // Highest preset radio should be checked on first load.
    const highestRadio = page.locator('input[type=radio][value=highest]');
    await expect(highestRadio).toBeChecked();

    // "Done" closes the modal.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Modeling Quality' })).toHaveCount(0);
  });

  test('picking Low persists and reloads checked', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-quality');

    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=low]').check();

    const stored = await page.evaluate(() => localStorage.getItem('partwright-quality-settings-v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({ quality: 'low' });

    // Close + reopen modal — Low should still be the selected radio.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('#btn-quality').click();
    await expect(page.locator('input[type=radio][value=low]')).toBeChecked();
  });

  test('manifold-js engine applies the chosen segment count', async ({ page }) => {
    // Drive the sandbox via the in-page partwright console API. We run a
    // tiny sphere script under each preset and read the resulting triVerts
    // count — higher quality = more triangles.
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-quality');

    // Wait for the WASM engine to load.
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    type RunResult = { triangleCount?: number; error?: string };
    type PartwrightApi = { run: (code: string) => Promise<RunResult> };
    const sphereCode = 'const { Manifold } = api; return Manifold.sphere(5);';

    // Run once with Highest (default) — should produce many triangles.
    const high = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, sphereCode);
    expect(high.triangleCount ?? 0).toBeGreaterThan(2000); // 128-segment sphere is many thousands of tris

    // Drop to Low via the modal.
    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=low]').check();
    await page.getByRole('button', { name: 'Done' }).click();

    // Re-run the same code — should produce far fewer triangles.
    const low = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, sphereCode);
    expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
    expect(low.triangleCount ?? 0).toBeGreaterThan(0);
  });

  test('Ultra preset persists and yields more triangles than the default', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-quality');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    type RunResult = { triangleCount?: number; error?: string };
    type PartwrightApi = { run: (code: string) => Promise<RunResult> };
    // A cylinder stays cheap at 1024 segments (~4k tris); a sphere would be
    // ~2M and too heavy for a smoke test. Either way the count must climb.
    const cylinderCode = 'const { Manifold } = api; return Manifold.cylinder(5, 3, 3);';

    // Baseline at the default (Highest = 128 segments).
    const high = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);

    // Switch to Ultra (1024 segments) and confirm it persists.
    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=ultra]').check();
    const stored = await page.evaluate(() => localStorage.getItem('partwright-quality-settings-v1'));
    expect(JSON.parse(stored!)).toEqual({ quality: 'ultra' });
    await page.getByRole('button', { name: 'Done' }).click();

    const ultra = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);
    expect(ultra.triangleCount ?? 0).toBeGreaterThan(high.triangleCount ?? 0);
  });
});
