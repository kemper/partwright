import { test, expect } from 'playwright/test';

// The viewport "Light" toggle: studio image-based lighting + a mild contact
// shadow, off by default (opt-in so the default view stays calm/matte).
test.describe('studio lighting toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
  });

  test('Light pill is off by default and toggles studio lighting on/off', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, null, { timeout: 30000 });

    const lightBtn = page.locator('#light-toggle');
    await expect(lightBtn).toBeVisible();

    const isOn = () => page.evaluate(() => (window as unknown as { partwright: { isStudioLighting(): boolean } }).partwright.isStudioLighting());

    // Off by default.
    expect(await isOn()).toBe(false);

    // Click turns it on (the PMREM env bake can take a moment on software WebGL).
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 20000 }).toBe(true);

    // Click again turns it back off.
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 10000 }).toBe(false);
  });
});
