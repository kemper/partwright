import { test, expect } from 'playwright/test';

// Two pages in the same BrowserContext share the origin's IndexedDB and Web
// Locks, so we can exercise the single-writer lock: opening the same session in
// a second tab should make it a read-only viewer.
test.describe('Multi-tab single-writer lock', () => {
  test('second tab on the same session is read-only with take-over', async ({ context }) => {
    const page1 = await context.newPage();
    await page1.goto('/editor');
    await page1.waitForSelector('text=Ready', { timeout: 15000 });

    const sessionId = await page1.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const s = await pw.createSession('lock-test');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'base');
      return s.id as string;
    });

    // page1 owns the write lock — no viewer banner.
    await expect(page1.locator('#session-viewer-banner')).toHaveCount(0);

    // Open the same session in a second tab.
    const page2 = await context.newPage();
    await page2.goto(`/editor?session=${sessionId}`);
    await page2.waitForSelector('text=Ready', { timeout: 15000 });

    // page2 is the read-only viewer: banner shown, save + paint disabled.
    await expect(page2.locator('#session-viewer-banner')).toBeVisible({ timeout: 10000 });
    await expect(page2.locator('#btn-save-version')).toBeDisabled();
    await expect(page2.locator('#paint-toggle')).toBeDisabled();
    // page1 remains the owner.
    await expect(page1.locator('#session-viewer-banner')).toHaveCount(0);

    // Take over from page2 → ownership flips.
    await page2.locator('#session-viewer-banner button:has-text("Take over")').click();
    await expect(page1.locator('#session-viewer-banner')).toBeVisible({ timeout: 10000 });
    await expect(page2.locator('#session-viewer-banner')).toHaveCount(0, { timeout: 10000 });
    // The new owner (page2) can save again.
    await expect(page2.locator('#btn-save-version')).toBeEnabled();

    await page1.close();
    await page2.close();
  });
});
