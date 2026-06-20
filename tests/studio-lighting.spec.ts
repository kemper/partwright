import { test, expect } from 'playwright/test';

// The viewport "Light" toggle: studio image-based lighting + a mild contact
// shadow, on by default, toggleable from the viewport. Re-toggling must keep
// working across off→on→off cycles (regression: a stale env-cache flag once
// broke re-enabling).
test.describe('studio lighting toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
  });

  test('Light pill is on by default and toggles cleanly across cycles', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, null, { timeout: 30000 });

    const lightBtn = page.locator('#light-toggle');
    await expect(lightBtn).toBeVisible();

    const isOn = () => page.evaluate(() => (window as unknown as { partwright: { isStudioLighting(): boolean } }).partwright.isStudioLighting());

    // On by default.
    expect(await isOn()).toBe(true);

    // Off → on → off → on must all register (not just the first cycle).
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 10000 }).toBe(false);
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 20000 }).toBe(true);
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 10000 }).toBe(false);
    await lightBtn.click();
    await expect.poll(isOn, { timeout: 10000 }).toBe(true);
  });
});
