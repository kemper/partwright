import { test, expect } from 'playwright/test';

// Verifies the new modeling-quality settings modal + persistence wiring.
//   1. Toolbar exposes a gear button that opens the modal.
//   2. The modal defaults to "Highest" the first time it loads (clean storage).
//   3. Picking a different preset persists to localStorage and triggers a re-render.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Modeling quality settings', () => {
  test('toolbar gear opens modal showing Highest as default', async ({ page }) => {
    await page.goto('/editor');
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
    await page.goto('/editor');
    await page.waitForSelector('#btn-quality');

    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=low]').check();

    const stored = await page.evaluate(() => localStorage.getItem('partwright-quality-settings-v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toMatchObject({ quality: 'low' });

    // Close + reopen modal — Low should still be the selected radio.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('#btn-quality').click();
    await expect(page.locator('input[type=radio][value=low]')).toBeChecked();
  });

  test('manifold-js engine applies the chosen segment count', async ({ page }) => {
    // Drive the sandbox via the in-page partwright console API. We run a
    // tiny sphere script under each preset and read the resulting triVerts
    // count — higher quality = more triangles.
    await page.goto('/editor');
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
    await page.goto('/editor');
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
    expect(JSON.parse(stored!)).toMatchObject({ quality: 'ultra' });
    await page.getByRole('button', { name: 'Done' }).click();

    const ultra = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);
    expect(ultra.triangleCount ?? 0).toBeGreaterThan(high.triangleCount ?? 0);
  });

  test('Custom preset persists a user-entered segment count', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-quality');

    await page.locator('#btn-quality').click();

    // The custom field is disabled until the Custom radio is selected.
    const input = page.locator('#quality-custom-input');
    await expect(input).toBeDisabled();
    await page.locator('input[type=radio][value=custom]').check();
    await expect(input).toBeEnabled();

    await input.fill('200');
    await input.blur();

    const stored = await page.evaluate(() => localStorage.getItem('partwright-quality-settings-v1'));
    expect(JSON.parse(stored!)).toMatchObject({ quality: 'custom', customSegments: 200 });

    // Close + reopen — Custom stays selected and the field shows 200.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('#btn-quality').click();
    await expect(page.locator('input[type=radio][value=custom]')).toBeChecked();
    await expect(page.locator('#quality-custom-input')).toHaveValue('200');
  });

  test('Custom value clamps to the allowed range on blur', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-quality');

    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=custom]').check();

    const input = page.locator('#quality-custom-input');
    await input.fill('999999');
    await input.blur();
    await expect(input).toHaveValue('4096'); // MAX_CUSTOM_SEGMENTS

    await input.fill('1');
    await input.blur();
    await expect(input).toHaveValue('3'); // MIN_CUSTOM_SEGMENTS

    const stored = await page.evaluate(() => localStorage.getItem('partwright-quality-settings-v1'));
    expect(JSON.parse(stored!)).toMatchObject({ quality: 'custom', customSegments: 3 });
  });

  test('manifold-js engine applies a custom segment count', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-quality');
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

    // Dial in a custom count well above 128.
    await page.locator('#btn-quality').click();
    await page.locator('input[type=radio][value=custom]').check();
    await page.locator('#quality-custom-input').fill('512');
    await page.locator('#quality-custom-input').blur();
    await page.getByRole('button', { name: 'Done' }).click();

    const custom = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, cylinderCode);
    expect(custom.triangleCount ?? 0).toBeGreaterThan(high.triangleCount ?? 0);
  });
});
