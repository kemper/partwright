// The parts list is reachable on mobile via a dedicated "Parts" pane in the
// Code / Parts / Viewport toggle. On a phone the activity rail collapses to a
// horizontal strip, so the rail can't host the parts list as a left column —
// without this pane there'd be no way to view or switch parts in viewport mode.

import { test, expect } from 'playwright/test';

test.describe('mobile parts pane', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-visit guided tour so its tooltip can't intercept taps.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.setViewportSize({ width: 375, height: 800 });
  });

  test('Parts pane shows the full-width parts list and the toggle has three options', async ({ page }) => {
    await page.goto('/editor');
    // Wait for the editor engine to settle.
    await page.waitForSelector('#parts-rail', { state: 'attached' });
    await page.waitForTimeout(2000);

    const toggle = page.locator('#mobile-pane-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle.getByRole('button', { name: 'Code', exact: true })).toBeVisible();
    await expect(toggle.getByRole('button', { name: 'Parts', exact: true })).toBeVisible();
    await expect(toggle.getByRole('button', { name: 'Viewport', exact: true })).toBeVisible();

    // Default mobile pane is the viewport — the parts rail is hidden.
    await expect(page.locator('#parts-rail')).toBeHidden();

    // Tapping Parts reveals the parts list (with at least one part row).
    await toggle.getByRole('button', { name: 'Parts', exact: true }).click();
    const railEl = page.locator('#parts-rail');
    await expect(railEl).toBeVisible();
    await expect(page.locator('#parts-list [data-part-id]').first()).toBeVisible();
    await expect(page.locator('#btn-add-part')).toBeVisible();
    // It fills the width rather than sitting as a cramped fixed column.
    const railWidth = (await railEl.boundingBox())!.width;
    expect(railWidth).toBeGreaterThan(300);

    // Switching to Code hides the parts rail again (full-width editor).
    await toggle.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(page.locator('#parts-rail')).toBeHidden();
    await expect(page.locator('#editor-container')).toBeVisible();
  });
});
