// Golden-path coverage for the viewport overlay bar: the display toggles that
// sit directly on the strip (edges/grid/dims/lock) plus the Inspect / Tools
// popovers that collect the tool-launching buttons. The popovers are sticky —
// clicking an item inside leaves the list open so you can flip tools in a row.
//
// Uses `dispatchEvent('click')` on the buttons to dodge the onboarding tour
// backdrop that intercepts real pointer events on first paint.

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
  test('the bar shows primaries, direct display toggles, and two group buttons', async ({ page }) => {
    await openEditor(page);
    // Always-visible primaries.
    await expect(page.locator('#triangle-count')).toBeVisible();
    await expect(page.locator('#reset-view')).toBeVisible();
    // Display toggles sit directly on the bar — visible immediately, no menu.
    await expect(page.locator('#wireframe-toggle')).toBeVisible();
    await expect(page.locator('#grid-toggle')).toBeVisible();
    await expect(page.locator('#dimensions-toggle')).toBeVisible();
    await expect(page.locator('#orbit-lock-toggle')).toBeVisible();
    // The View menu is gone; only Inspect and Tools remain as popovers.
    await expect(page.locator('#viewport-view-group-btn')).toHaveCount(0);
    await expect(page.locator('#viewport-inspect-group-btn')).toBeVisible();
    await expect(page.locator('#viewport-tools-group-btn')).toBeVisible();
  });

  test('Inspect popover holds measure + cross-section and stays open across picks', async ({ page }) => {
    await openEditor(page);

    // Hidden until opened.
    await expect(page.locator('#measure-toggle')).toBeHidden();
    await page.locator('#viewport-inspect-group-btn').dispatchEvent('click');
    await expect(page.locator('#measure-toggle')).toBeVisible();
    await expect(page.locator('#clip-toggle')).toBeVisible();

    // Sticky: picking a tool inside leaves the list open (no closeOnSelect).
    await page.locator('#measure-toggle').dispatchEvent('click');
    await expect(page.locator('#measure-toggle')).toBeVisible();
    await expect(page.locator('#clip-toggle')).toBeVisible();

    // Clicking the group button again closes it.
    await page.locator('#viewport-inspect-group-btn').dispatchEvent('click');
    await expect(page.locator('#measure-toggle')).toBeHidden();
  });

  test('Tools popover collects the editing tools and stays open when a tool opens', async ({ page }) => {
    await openEditor(page);
    await page.locator('#viewport-tools-group-btn').dispatchEvent('click');

    // The injected editing tools all mounted into the Tools menu.
    for (const id of ['#paint-toggle', '#palette-manager-toggle', '#annotate-toggle', '#simplify-toggle', '#surface-viewport-toggle', '#resize-viewport-toggle']) {
      await expect(page.locator(`#viewport-tools-menu ${id}`)).toHaveCount(1);
    }

    // Selecting a tool opens its panel AND keeps the Tools menu open so the user
    // can switch to another tool without re-opening the list.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(page.locator('#paint-toggle')).toBeVisible();
    await expect(page.locator('#annotate-toggle')).toBeVisible();

    // Opening a sibling popover (Inspect) closes Tools — single popover at a time.
    await page.locator('#viewport-inspect-group-btn').dispatchEvent('click');
    await expect(page.locator('#paint-toggle')).toBeHidden();
    await expect(page.locator('#measure-toggle')).toBeVisible();
  });

  test('clicking the viewport canvas keeps the Tools menu and the open tool panel up', async ({ page }) => {
    await openEditor(page);
    await page.locator('#viewport-tools-group-btn').dispatchEvent('click');

    // Open a tool so both the launcher row and its docked panel are showing.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // A click on empty space in the 3D viewport canvas is a camera/orbit intent
    // (clicking away from the model to rotate it), NOT a dismiss — so it must leave
    // both the Tools menu and the active tool's panel open. Regression for the bug
    // where an off-model viewport click collapsed the Tools row but stranded the
    // tool panel. The tour is pre-dismissed in openEditor, so a real click lands.
    const box = await page.locator('#viewport').boundingBox();
    if (!box) throw new Error('viewport canvas has no bounding box');
    // Bottom-left corner — empty 3D canvas, clear of the centered model AND of the
    // overlay toolbar that hugs the viewport's TOP edge. (A top corner is unsafe:
    // when the code pane is shown the viewport narrows and the toolbar's first row
    // reaches down into it, so a top-corner "canvas" click can land on a toolbar
    // chip instead.)
    await page.mouse.click(box.x + 24, box.y + box.height - 24);
    await expect(page.locator('#paint-toggle')).toBeVisible();
    await expect(page.locator('#paint-picker-panel')).toBeVisible();
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
