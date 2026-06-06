// Golden-path coverage for the grouped viewport overlay bar: the View / Inspect
// / Tools popovers that collapse the previously-flat strip of ~16 buttons.
//
// Uses `dispatchEvent('click')` on the group buttons to dodge the onboarding
// tour backdrop that intercepts real pointer events on first paint.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  // Pre-dismiss the first-run tour so its backdrop/keys don't intercept input.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`);
  });
}

test.describe('viewport toolbar groups', () => {
  test('the bar collapses to primaries plus three labelled group buttons', async ({ page }) => {
    await openEditor(page);
    // Always-visible primaries.
    await expect(page.locator('#triangle-count')).toBeVisible();
    await expect(page.locator('#reset-view')).toBeVisible();
    // The three group buttons.
    await expect(page.locator('#viewport-view-group-btn')).toBeVisible();
    await expect(page.locator('#viewport-inspect-group-btn')).toBeVisible();
    await expect(page.locator('#viewport-tools-group-btn')).toBeVisible();
  });

  test('View popover holds the display toggles; Inspect holds measure + cross-section', async ({ page }) => {
    await openEditor(page);

    // Display toggles live inside the View popover and are hidden until opened.
    await expect(page.locator('#wireframe-toggle')).toBeHidden();
    await page.locator('#viewport-view-group-btn').dispatchEvent('click');
    await expect(page.locator('#wireframe-toggle')).toBeVisible();
    await expect(page.locator('#grid-toggle')).toBeVisible();
    await expect(page.locator('#dimensions-toggle')).toBeVisible();
    await expect(page.locator('#orbit-lock-toggle')).toBeVisible();

    // Opening Inspect closes View (single popover at a time) and reveals the
    // read-only analysis tools.
    await page.locator('#viewport-inspect-group-btn').dispatchEvent('click');
    await expect(page.locator('#wireframe-toggle')).toBeHidden();
    await expect(page.locator('#measure-toggle')).toBeVisible();
    await expect(page.locator('#clip-toggle')).toBeVisible();
  });

  test('Tools popover collects the editing tools and a tool opens from it', async ({ page }) => {
    await openEditor(page);
    await page.locator('#viewport-tools-group-btn').dispatchEvent('click');

    // The injected editing tools all mounted into the Tools menu.
    for (const id of ['#paint-toggle', '#palette-manager-toggle', '#annotate-toggle', '#simplify-toggle', '#surface-viewport-toggle', '#resize-viewport-toggle']) {
      await expect(page.locator(`#viewport-tools-menu ${id}`)).toHaveCount(1);
    }

    // Selecting a tool from the popover opens its panel.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  });

  test('grouped viewport tools are reachable from the command palette', async ({ page }) => {
    await openEditor(page);
    // Open the palette and search for the Paint tool command — the palette is the
    // flat, searchable index that keeps the grouping discoverable.
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('input[aria-label="Search commands"]');
    await expect(input).toBeVisible();
    await input.fill('Paint colors');
    await expect(page.locator('[role="option"]').filter({ hasText: 'Paint colors' })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  });
});
