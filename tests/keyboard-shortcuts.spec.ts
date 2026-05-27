// Keyboard shortcuts: save (mod+S) and focus/tool-routed undo/redo
// (mod+Z, mod+Shift+Z). Uses Playwright's `ControlOrMeta` modifier so the
// same press maps to ⌘ on macOS and Ctrl elsewhere — mirroring the app's
// own OS detection in src/ui/shortcutDefs.ts.
//
// `dispatchEvent('click')` opens the paint panel to dodge the first-run tour
// backdrop that intercepts real pointer events (same trick the paint specs use).

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`);
  });
}

test.describe('keyboard shortcuts', () => {
  test('mod+S saves a version and reports no-op on a clean save', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('kbd-save-test');
      // Make the editor content dirty so the first save always commits a version.
      pw.setCode('return api.Manifold.cube([7, 7, 7], true);');
    });

    await page.keyboard.press('ControlOrMeta+s');
    await expect(
      page.locator('div[role="status"]').filter({ hasText: /Saved v\d+/ }),
    ).toBeVisible();

    // Second save with no further edits is a no-op.
    await page.keyboard.press('ControlOrMeta+s');
    await expect(
      page.locator('div[role="status"]').filter({ hasText: 'No changes to save' }),
    ).toBeVisible();
  });

  test('mod+Z / mod+Shift+Z undo and redo a paint region while painting', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const pw = (window as unknown as { partwright: {
        paintFaces(opts: { triangleIds: number[]; color: [number, number, number]; name?: string }): { id: number };
      } }).partwright;
      pw.paintFaces({ triangleIds: [0, 1, 2], color: [1, 0, 0], name: 'A' });
      pw.paintFaces({ triangleIds: [3, 4, 5], color: [0, 1, 0], name: 'B' });
    });

    // Open the paint panel so undo/redo route to paint regions.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const count = () => page.evaluate(() => {
      const pw = (window as unknown as { partwright: { listRegions(): unknown[] } }).partwright;
      return pw.listRegions().length;
    });

    expect(await count()).toBe(2);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(count).toBe(1);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(count).toBe(2);
  });

  test('undo is not hijacked while a text input is focused', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const pw = (window as unknown as { partwright: {
        paintFaces(opts: { triangleIds: number[]; color: [number, number, number] }): { id: number };
      } }).partwright;
      pw.paintFaces({ triangleIds: [0, 1, 2], color: [1, 0, 0] });
      pw.paintFaces({ triangleIds: [3, 4, 5], color: [0, 1, 0] });
    });

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Bucket is no longer the default tool, so its angle input starts hidden —
    // reveal it first (a display:none input can't take focus).
    await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');

    // Focus a numeric input inside the paint panel, then press undo. The handler
    // must defer to the field's native editing and leave paint regions intact.
    const angleInput = page.locator('#paint-picker-panel input[type="number"][title*="Bend angle"]');
    await angleInput.focus();
    await page.keyboard.press('ControlOrMeta+z');

    const remaining = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { listRegions(): unknown[] } }).partwright;
      return pw.listRegions().length;
    });
    expect(remaining).toBe(2);
  });
});
