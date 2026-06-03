// The /catalog page is pre-rendered as an app-free static page at build time
// (from the manifest + payloads in public/catalog/), grouped into category
// sections (Customizable, JavaScript, SDF, OpenSCAD, BREP) with parametric
// tiles badged. Tiles are plain <a> links into the editor; thumbnails hydrate
// client-side. Direct navigation serves the static page (dev/preview
// middleware + Cloudflare _redirects); the editor soft-renders an in-app copy.

import { test, expect, type Page } from 'playwright/test';

async function gotoCatalog(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/catalog');
  await page.waitForSelector('main section[data-category]', { timeout: 20_000 });
}

test.describe('Catalog page (static)', () => {
  test('is app-free with category sections in order, each with a count and blurb', async ({ page }) => {
    await gotoCatalog(page);

    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);

    const sections = page.locator('main section[data-category]');
    await expect(sections).toHaveCount(5);

    const ids = await sections.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category));
    expect(ids).toEqual(['customizable', 'manifold', 'sdf', 'scad', 'brep']);

    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const sec = sections.nth(i);
      await expect(sec.locator('h2')).toBeVisible();
      await expect(sec.locator('h2 + span')).toHaveText(/^\d+$/);
      await expect(sec.locator('p')).not.toBeEmpty();
      expect(await sec.locator('div.grid > a').count()).toBeGreaterThan(0);
    }
  });

  test('the Customizable section holds the parametric models and tags them', async ({ page }) => {
    await gotoCatalog(page);

    const customizable = page.locator('main section[data-category="customizable"]');
    const tiles = customizable.locator('div.grid > a');
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThan(0);

    await expect(customizable.locator('span:has-text("Parametric")')).toHaveCount(tileCount);
    const totalBadges = await page.locator('main span:has-text("Parametric")').count();
    expect(totalBadges).toBe(tileCount);

    await expect(customizable).toContainText('Layer Cake');
  });

  test('a tile is a link to /editor?catalog= and imports the session on click', async ({ page }) => {
    await gotoCatalog(page);
    const firstTile = page.locator('main section[data-category] div.grid > a').first();
    await expect(firstTile).toHaveAttribute('href', /^\/editor\?catalog=/);
    await firstTile.click();
    await expect(page).toHaveURL(/\/editor/, { timeout: 30_000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30_000 });
  });

  test('the editor still soft-renders the in-app catalog (no reload)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, { timeout: 30_000 });
    await page.locator('#btn-catalog').click();
    await expect(page.locator('#catalog-page')).toBeVisible({ timeout: 20_000 });
    // Soft render — the app is still loaded (no full navigation reset it).
    expect(await page.evaluate(() => 'partwright' in window)).toBe(true);
  });
});
