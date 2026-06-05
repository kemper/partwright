import { test, expect } from 'playwright/test';

// Verifies the Curvature Quality panel (viewport overlay) — the primary UI
// for adjusting the circular segment count used for geometry runs.
//   1. The panel opens from the "○ Quality" button in the viewport controls.
//   2. It defaults to "Highest" for manifold-js on first load (clean storage).
//   3. Picking a different preset persists to localStorage and triggers a re-render.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Modeling quality settings', () => {
  test('viewport quality button opens panel showing Highest as default', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#simplify-toggle');

    await page.locator('#simplify-toggle').click();
    await expect(page.locator('#simplify-panel')).toBeVisible();

    // Highest preset radio should be checked on first load.
    const highestRadio = page.locator('#simplify-panel input[type=radio][value=highest]');
    await expect(highestRadio).toBeChecked();

    // X button closes the panel (hides it).
    await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();
    await expect(page.locator('#simplify-panel')).not.toBeVisible();
  });

  test('applying Low is reflected in panel and in-memory', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#simplify-toggle');

    await page.locator('#simplify-toggle').click();
    await page.locator('#simplify-panel input[type=radio][value=low]').check();

    // Radio should be checked immediately (live preview).
    await expect(page.locator('#simplify-panel input[type=radio][value=low]')).toBeChecked();

    // Apply quality becomes enabled once the preview differs; click to commit.
    const applyBtn = page.locator('#quality-apply');
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await expect(applyBtn).toBeDisabled(); // committed → no-op again

    // Close + reopen panel — Low should still be selected (committed in-memory).
    await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();
    await page.locator('#simplify-toggle').click();
    await expect(page.locator('#simplify-panel input[type=radio][value=low]')).toBeChecked();
  });

  test('closing without Apply reverts the quality preview', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#simplify-toggle');

    await page.locator('#simplify-toggle').click();
    // Default is Highest; preview Low without applying.
    await expect(page.locator('#simplify-panel input[type=radio][value=highest]')).toBeChecked();
    await page.locator('#simplify-panel input[type=radio][value=low]').check();
    await expect(page.locator('#simplify-panel input[type=radio][value=low]')).toBeChecked();

    // Close without Apply — the preview should snap back to the committed Highest.
    await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();
    await page.locator('#simplify-toggle').click();
    await expect(page.locator('#simplify-panel input[type=radio][value=highest]')).toBeChecked();
    // Apply is disabled again because nothing is pending after the revert.
    await expect(page.locator('#quality-apply')).toBeDisabled();
  });

  test('manifold-js engine applies the chosen segment count', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#simplify-toggle');
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
    expect(high.triangleCount ?? 0).toBeGreaterThan(2000);

    // Drop to Low via the panel and Apply to commit it.
    await page.locator('#simplify-toggle').click();
    await page.locator('#simplify-panel input[type=radio][value=low]').check();
    await page.locator('#quality-apply').click();
    await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();

    // Re-run the same code — should produce far fewer triangles.
    const low = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, sphereCode);
    expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
    expect(low.triangleCount ?? 0).toBeGreaterThan(0);
  });

  test('Ultra preset persists and yields more triangles than the default', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#simplify-toggle');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    type RunResult = { triangleCount?: number; error?: string };
    type PartwrightApi = { run: (code: string) => Promise<RunResult> };
    const cylinderCode = 'const { Manifold } = api; return Manifold.cylinder(5, 3, 3);';

    // Baseline at the default (Highest = 128 segments).
    const high = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);

    // Switch to Ultra (1024 segments) and Apply to commit it.
    await page.locator('#simplify-toggle').click();
    await page.locator('#simplify-panel input[type=radio][value=ultra]').check();
    await expect(page.locator('#simplify-panel input[type=radio][value=ultra]')).toBeChecked();
    await page.locator('#quality-apply').click();
    await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();

    const ultra = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);
    expect(ultra.triangleCount ?? 0).toBeGreaterThan(high.triangleCount ?? 0);
  });
});
