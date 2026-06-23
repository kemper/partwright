// The shared palette colour-picker modal (src/ui/colorPickerModal.ts) that
// replaces the native OS <input type="color"> across the app. Golden path:
//   1. Opening a swatch shows the palette + a freeform "Custom" picker.
//   2. Clicking a palette slot swatch commits that colour immediately.
//   3. A freeform pick + Apply commits the colour AND records it to "Recent",
//      so it's a one-click swatch the next time the picker opens.

import { test, expect } from 'playwright/test';

async function openEditorWithLabels(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).partwright.run(`
      const { Manifold } = api;
      const body = api.label(Manifold.sphere(20, 32), 'body');
      const nose = api.label(Manifold.sphere(3, 16).translate([0, 19, 0]), 'nose');
      return body.add(nose);
    `);
  });
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
}

test.describe('palette colour picker modal', () => {
  test('palette swatch commits, freeform pick records to Recent', async ({ page }) => {
    await openEditorWithLabels(page);

    const noseSwatch = page.locator('#paint-label-list [data-label-name="nose"] button[data-action="set-label-color"]');

    // Opening shows the palette grid + the freeform custom input.
    await noseSwatch.dispatchEvent('click');
    const modal = page.locator('[data-testid="color-picker"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('input[data-action="custom-color"]')).toBeVisible();
    const paletteSwatches = modal.locator('.grid button[data-hex]');
    expect(await paletteSwatches.count()).toBeGreaterThan(0);

    // Clicking the first palette slot commits its colour immediately (modal closes).
    const firstHex = await paletteSwatches.first().getAttribute('data-hex');
    await paletteSwatches.first().dispatchEvent('click');
    await expect(modal).toBeHidden();

    const noseColor = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regions = (window as any).partwright.listRegions() as { name: string; color: [number, number, number] }[];
      const r = regions.find(x => x.name === 'nose');
      if (!r) return null;
      const [a, b, c] = r.color;
      const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
      return `#${h(a)}${h(b)}${h(c)}`;
    });
    expect(noseColor).toBe(firstHex);

    // Now a freeform pick → Apply records the colour to Recent.
    await noseSwatch.dispatchEvent('click');
    await expect(modal).toBeVisible();
    await page.evaluate(() => {
      const ov = document.querySelector('[data-testid="color-picker"]')!;
      const ci = ov.querySelector('input[data-action="custom-color"]') as HTMLInputElement;
      ci.value = '#12ab56';
      ci.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await modal.locator('button:has-text("Apply")').dispatchEvent('click');
    await expect(modal).toBeHidden();

    // Reopen — the freeform colour is now a Recent swatch.
    await noseSwatch.dispatchEvent('click');
    await expect(modal).toBeVisible();
    await expect(modal.locator('button[data-hex="#12ab56"]')).toHaveCount(1);
  });
});
