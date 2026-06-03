// Phase 1: filament palette + slot-aware painting. Covers the golden path:
//   - the paint panel's swatch grid is driven by the shared colour palette
//   - picking a slot and painting attributes the region to that slot's colour
//   - the over-budget badge appears when distinct slots used > palette capacity
//
// Painting is driven by the Bucket tool over a wide flat slab so a single
// canvas pointer click reliably hits the top face (same approach as the smooth
// brush spec's centre-ray drag).

import { test, expect } from 'playwright/test';

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

    // Drop the printer capacity to 1 via the palette editor → 2 slots used now
    // exceeds it, so the over-budget badge appears.
    await page.locator('#paint-picker-panel button[title="Edit palette slots and capacity"]').dispatchEvent('click');
    const capInput = page.locator('#paint-picker-panel input[title*="filament slots"]');
    await capInput.fill('1');
    await capInput.dispatchEvent('change');

    const badge = page.locator('#paint-picker-panel').getByText(/\/1 slots/);
    await expect(badge).toBeVisible();
  });
});
