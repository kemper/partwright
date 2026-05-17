import { test, expect } from 'playwright/test';

// Verifies the Preferences modal — covers quality, default mesh color,
// and auto-render delay. Each setting persists to localStorage and
// (for the engine-driven ones) actually changes what the renderer does.

test.describe('Preferences modal', () => {
  test('toolbar gear opens modal with sensible defaults', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-preferences');

    await page.locator('#btn-preferences').click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();

    // Defaults: Highest quality, Blue mesh color, Normal render delay.
    await expect(page.locator('input[type=radio][value=highest]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=blue]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=normal]')).toBeChecked();

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toHaveCount(0);
  });

  test('all settings persist to localStorage', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-preferences');

    await page.locator('#btn-preferences').click();
    await page.locator('input[type=radio][value=low]').check();
    await page.locator('input[type=radio][value=emerald]').check();
    await page.locator('input[type=radio][value=relaxed]').check();
    await page.locator('input[type=radio][value=cap20]').check();
    await page.locator('input[type=radio][value=on][name=aiPaintDefault]').check();

    const stored = await page.evaluate(() => localStorage.getItem('partwright-preferences-v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({
      quality: 'low',
      meshColor: 'emerald',
      renderDelay: 'relaxed',
      lifetimeSpendCap: 'cap20',
      aiPaintDefault: 'on',
    });

    // Close + reopen — selections persist.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('#btn-preferences').click();
    await expect(page.locator('input[type=radio][value=low]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=emerald]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=relaxed]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=cap20]')).toBeChecked();
    await expect(page.locator('input[type=radio][value=on][name=aiPaintDefault]')).toBeChecked();
  });

  test('toggling AI paint default writes through to AI settings', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-preferences');

    // Default: paint should be off in AI settings (per `standard` preset).
    let aiSettings = await page.evaluate(() =>
      localStorage.getItem('partwright-ai-settings-v1'),
    );
    expect(aiSettings === null || JSON.parse(aiSettings).toggles.scope.paintFaces === false).toBe(true);

    await page.locator('#btn-preferences').click();
    await page.locator('input[type=radio][value=on][name=aiPaintDefault]').check();
    await page.getByRole('button', { name: 'Done' }).click();

    // AI settings should now have paintFaces=true after the preference write-through.
    aiSettings = await page.evaluate(() => localStorage.getItem('partwright-ai-settings-v1'));
    expect(aiSettings).toBeTruthy();
    expect(JSON.parse(aiSettings!).toggles.scope.paintFaces).toBe(true);
  });

  test('manifold-js engine applies the chosen segment count', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-preferences');

    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    type RunResult = { triangleCount?: number; error?: string };
    type PartwrightApi = { run: (code: string) => Promise<RunResult> };
    const sphereCode = 'const { Manifold } = api; return Manifold.sphere(5);';

    const high = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, sphereCode);
    expect(high.triangleCount ?? 0).toBeGreaterThan(2000); // ~32k tris at 128 segments

    await page.locator('#btn-preferences').click();
    await page.locator('input[type=radio][value=low]').check();
    await page.getByRole('button', { name: 'Done' }).click();

    const low = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, sphereCode);
    expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
    expect(low.triangleCount ?? 0).toBeGreaterThan(0);
  });
});
