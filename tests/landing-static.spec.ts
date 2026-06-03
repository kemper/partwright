import { test, expect } from 'playwright/test';

// The landing route ("/") is a separate static document (index.html's
// #landing-inline), enhanced in place by src/landing/landingEntry.ts. It must
// NOT load the app bundle (src/main.ts + Three.js / CodeMirror / manifold);
// the app loads only when the user navigates into the editor/catalog/etc. via
// a real navigation. These tests lock in that contract and the URL-based
// hand-offs that replaced the old in-memory landing callbacks.

test.describe('Static, app-free landing route', () => {
  test('renders without booting the app, and enhances its grids in place', async ({ page }) => {
    await page.goto('/');
    // Static hero is present immediately.
    const landing = page.locator('#landing-inline');
    await expect(landing).toBeVisible();
    await expect(landing.getByRole('heading', { level: 1 })).toBeVisible();

    // The app bundle never booted: its console API and AI panel are absent.
    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);
    await expect(page.locator('#ai-panel')).toHaveCount(0);

    // The async islands enhance in place: catalog tiles become links into the
    // editor, and the recent-sessions grid resolves (to tiles or an empty note).
    await expect(page.locator('#li-catalog-grid a').first()).toBeVisible({ timeout: 15000 });
    for (const href of await page.locator('#li-catalog-grid a').evaluateAll(els => els.map(e => (e as HTMLAnchorElement).getAttribute('href') ?? ''))) {
      expect(href).toMatch(/^\/editor\?catalog=/);
    }
    await expect(page.locator('#li-sessions-grid > *').first()).toBeVisible({ timeout: 15000 });
  });

  test('a catalog tile loads that entry into the editor via /editor?catalog=', async ({ page }) => {
    await page.goto('/');
    const firstTile = page.locator('#li-catalog-grid a').first();
    await expect(firstTile).toBeVisible({ timeout: 15000 });
    const href = await firstTile.getAttribute('href');
    expect(href).toMatch(/^\/editor\?catalog=/);

    // Hard-navigate to the catalog deep-link (the app boots here on demand).
    await page.goto(href!);

    // The editor loads and imports the entry: code pane shows, the app booted,
    // and importSessionPayload's openSession rewrites the URL to ?session=.
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => 'partwright' in window, null, { timeout: 30000 });
    await expect(page).toHaveURL(/\/editor\?session=/, { timeout: 30000 });
  });
});
