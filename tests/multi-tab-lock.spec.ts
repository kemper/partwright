import { test, expect } from 'playwright/test';

// Two pages in the same BrowserContext share the origin's localStorage and its
// `storage` events, so we can exercise the leader election: opening the same
// session in a second tab makes it a read-only viewer, and "Take control"
// reloads it as the leader while the first tab drops to read-only.
test.describe('Multi-tab single-writer leader', () => {
  test('second tab is read-only; Take control flips leadership', async ({ context }) => {
    const page1 = await context.newPage();
    await page1.goto('/editor');
    await page1.waitForSelector('text=Ready', { timeout: 15000 });

    const sessionId = await page1.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const s = await pw.createSession('leader-test');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'base');
      return s.id as string;
    });

    // page1 is the leader — no overlay.
    await expect(page1.locator('#session-viewer-overlay')).toHaveCount(0);

    // Open the same session in a second tab → it's the read-only viewer.
    const page2 = await context.newPage();
    await page2.goto(`/editor?session=${sessionId}`);
    await page2.waitForSelector('text=Ready', { timeout: 15000 });
    await expect(page2.locator('#session-viewer-overlay')).toBeVisible({ timeout: 10000 });
    await expect(page1.locator('#session-viewer-overlay')).toHaveCount(0);

    // Take control from page2 → it reloads as leader, page1 drops to read-only.
    await page2.locator('#session-viewer-overlay button:has-text("Take control")').click();
    await page2.waitForSelector('text=Ready', { timeout: 15000 });
    await expect(page2.locator('#session-viewer-overlay')).toHaveCount(0, { timeout: 10000 });
    await expect(page2).toHaveURL(/\/editor\?session=/);
    await expect(page2.url()).not.toContain('takeover');
    await expect(page1.locator('#session-viewer-overlay')).toBeVisible({ timeout: 10000 });

    // page2 (leader) saves a new version; page1 (read-only viewer) should mirror
    // to it rather than freezing on the version it had.
    await page2.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(8);', 'mirror');
    });
    const leaderV = new URL(page2.url()).searchParams.get('v');
    expect(leaderV).toBeTruthy();
    await expect(page1).toHaveURL(new RegExp(`[?&]v=${leaderV}(&|$)`), { timeout: 10000 });

    await page1.close();
    await page2.close();
  });
});
