// Phase 1: filament palette + slot-aware painting. Covers the golden path:
//   - the paint panel's swatch grid is driven by the shared colour palette
//   - picking a slot and painting attributes the region to that slot's colour
//   - the over-budget badge appears when distinct slots used > palette capacity
//
// Painting is driven by the Bucket tool over a wide flat slab so a single
// canvas pointer click reliably hits the top face (same approach as the smooth
// brush spec's centre-ray drag).

import { test, expect } from 'playwright/test';
import path from 'path';

async function openEditorWithSlab(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 6], true);`);
  });
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');
  await page.waitForTimeout(200); // let the viewport auto-frame the new mesh
}

/** Bucket-paint the top face at the viewport centre. */
async function bucketPaintCentre(page: import('playwright/test').Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (t: string, x: number, y: number, buttons: number) =>
      canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    fire('pointermove', cx, cy, 0);
    fire('pointerdown', cx, cy, 1);
    fire('pointerup', cx, cy, 0);
  });
}

test.describe('filament palette + slot painting', () => {
  test('swatches paint with the slot colour and over-budget badge fires', async ({ page }) => {
    await openEditorWithSlab(page);

    // The swatch grid is the palette: 6 named default slots are present.
    const swatches = page.locator('#paint-picker-panel button[title^="Slot "]');
    await expect(swatches).toHaveCount(6);

    // Pick the Red slot (slot 3) and bucket-paint the top face.
    await page.locator('#paint-picker-panel button[title^="Slot 3:"]').dispatchEvent('click');
    await bucketPaintCentre(page);

    // Pick the Blue slot (slot 5) and paint again (overlapping region, 2nd slot).
    await page.locator('#paint-picker-panel button[title^="Slot 5:"]').dispatchEvent('click');
    await bucketPaintCentre(page);

    const regions = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.listRegions();
    });
    expect(regions.length).toBe(2);
    // The first region took the Red slot's colour (def-red #c02525 ≈ 0.75,0.14,0.14).
    expect(regions[0].color[0]).toBeGreaterThan(0.6);
    expect(regions[0].color[2]).toBeLessThan(0.3);
    // The second took the Blue slot's colour (def-blue #2452c0).
    expect(regions[1].color[2]).toBeGreaterThan(0.6);
    expect(regions[1].color[0]).toBeLessThan(0.3);

    // Drop the printer capacity to 1 via the palette manager → 2 slots used now
    // exceeds it, so the over-budget badge appears in the paint panel.
    await page.locator('#palette-manager-toggle').dispatchEvent('click');
    const dialog = page.locator('[role="dialog"]');
    const capInput = dialog.locator('input[type="number"]');
    await capInput.fill('1');
    await capInput.dispatchEvent('change');
    await dialog.locator('button:has-text("Done")').dispatchEvent('click');

    const badge = page.locator('#paint-picker-panel').getByText(/\/1 slots/);
    await expect(badge).toBeVisible();
  });

  test('the palette manager opens from the viewport and its edits reach the swatches', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20000 });
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).partwright.run(`const { Manifold } = api; return Manifold.cube([20, 20, 6], true);`);
    });

    // Open the standalone manager from the viewport (not the paint menu).
    await page.locator('#palette-manager-toggle').dispatchEvent('click');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText('Filament palette');
    // Six default slots, each with a name input.
    await expect(dialog.locator('input[type="text"]')).toHaveCount(6);

    // Add a slot, then close.
    await dialog.locator('button:has-text("+ Add slot")').dispatchEvent('click');
    await expect(dialog.locator('input[type="text"]')).toHaveCount(7);
    await dialog.locator('button:has-text("Done")').dispatchEvent('click');

    // The paint panel's swatch grid reflects the added slot (live, via onPaletteChange).
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(page.locator('#paint-picker-panel button[title^="Slot "]')).toHaveCount(7);
  });

  test('import colours from a photo adds slots and records history', async ({ page }) => {
    // The eyedropper/swatch clicks are real clicks, so suppress the first-run
    // tour backdrop that would otherwise intercept them.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20000 });
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).partwright.run(`const { Manifold } = api; return Manifold.cube([20, 20, 6], true);`);
    });

    await page.locator('#palette-manager-toggle').dispatchEvent('click');
    await page.locator('[role="dialog"] button:has-text("Import from photo")').dispatchEvent('click');

    // Upload a colourful image and wait for the detected swatches.
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles(path.resolve('public/og-image.png'));
    await page.waitForSelector('[role="dialog"] button[data-hex]');

    // Toggle two detected colours + eyedrop a pixel, then add.
    await page.locator('[role="dialog"] button[data-hex]').nth(0).click();
    await page.locator('[role="dialog"] button[data-hex]').nth(2).click();
    await page.locator('[role="dialog"] canvas').click({ position: { x: 30, y: 25 } });
    await page.locator('[role="dialog"] button:has-text("Add")').click();

    // Returns to the manager with new slots + a populated history.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText('Filament palette');
    expect(await dialog.locator('input[type="text"]').count()).toBeGreaterThan(6); // 6 defaults + imports
    await expect(dialog).toContainText('Recent colours');
  });

  test('over-budget export shows a colour warning in the confirm modal', async ({ page }) => {
    // Real .click() on the toolbar needs the first-run tour backdrop gone.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await openEditorWithSlab(page);

    // Paint two distinct palette slots.
    await page.locator('#paint-picker-panel button[title^="Slot 3:"]').dispatchEvent('click');
    await bucketPaintCentre(page);
    await page.locator('#paint-picker-panel button[title^="Slot 5:"]').dispatchEvent('click');
    await bucketPaintCentre(page);

    // Capacity → 1 via the manager (2 colours used now exceeds it).
    await page.locator('#palette-manager-toggle').dispatchEvent('click');
    const cap = page.locator('[role="dialog"] input[type="number"]');
    await cap.fill('1');
    await cap.dispatchEvent('change');
    await page.locator('[role="dialog"] button:has-text("Done")').dispatchEvent('click');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    // Close the paint panel so it can't intercept the toolbar click.
    await page.locator('#paint-toggle').dispatchEvent('click');

    // Trigger 3MF export from the toolbar Export menu (the 3MF item is unique by
    // its Bambu description).
    await page.locator('#btn-export').click();
    await page.getByText('Native format for Bambu Studio multi-color prints.').click();

    const confirm = page.locator('[role="dialog"]:has-text("Export 3MF?")');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('More colours than slots');
    await expect(confirm).toContainText('uses 2 filament colours');
  });
});
