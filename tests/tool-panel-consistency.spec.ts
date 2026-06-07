// Golden-path coverage for the consistent tool-panel behaviour: every tool in
// the (horizontal) Tools menu opens a docked panel, opening one closes any
// other (single panel at a time), the Palette is a docked panel rather than a
// centered modal, and Escape closes panels.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20000 });
  await page.waitForFunction(() => Boolean((window as { partwright?: { run?: unknown } }).partwright?.run), null, { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).partwright.run(`const { Manifold } = api; return Manifold.cube([12, 12, 12], true);`);
  });
  await page.locator('#viewport-tools-group-btn').dispatchEvent('click');
}

test.describe('tool panel consistency', () => {
  test('opening a tool panel closes the previously open one', async ({ page }) => {
    await openEditor(page);

    // Open Paint.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Opening Quality must close Paint (was the "opens on top" bug).
    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    await expect(page.locator('#paint-picker-panel:not(.hidden)')).toHaveCount(0);

    // Opening Surface must close Quality.
    await page.locator('#surface-viewport-toggle').dispatchEvent('click');
    await expect(page.locator('#simplify-panel:not(.hidden)')).toHaveCount(0);
  });

  test('the palette manager is a docked, non-modal panel (no centered overlay)', async ({ page }) => {
    await openEditor(page);
    await page.locator('#palette-manager-toggle').dispatchEvent('click');

    const dialog = page.locator('[role="dialog"][aria-modal="false"]');
    await expect(dialog).toContainText('Filament palette');
    // It is NOT a centered backdrop overlay (the old modalShell look).
    await expect(page.locator('.fixed.inset-0.bg-black\\/60')).toHaveCount(0);

    // Opening Paint closes it (single tool panel at a time).
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(dialog).toHaveCount(0);
  });

  test('Escape closes the image-paint panel', async ({ page }) => {
    await openEditor(page);
    await page.locator('#image-paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#image-paint-panel:not(.hidden)');

    await page.keyboard.press('Escape');
    await expect(page.locator('#image-paint-panel:not(.hidden)')).toHaveCount(0);
  });
});
