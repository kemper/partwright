// The /catalog page groups its curated entries into category sections
// (Customizable, JavaScript, SDF, OpenSCAD, BREP) so a visitor can tell at a
// glance why each model is there, and tags parametric tiles with a badge.
// This drives the real page against the static manifest + payloads in
// public/catalog/ (no engine/WASM needed — the page only fetches JSON).

import { test, expect, type Page } from 'playwright/test';

async function gotoCatalog(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/catalog');
  await page.waitForSelector('#catalog-page section[data-category]', { timeout: 20_000 });
}

test.describe('Catalog categories', () => {
  test('renders category sections in order, each with a count and blurb', async ({ page }) => {
    await gotoCatalog(page);

    const sections = page.locator('#catalog-page section[data-category]');
    // Sections only render when non-empty; the shipped catalog populates all
    // five, in this canonical order.
    await expect(sections).toHaveCount(5);

    const ids = await sections.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category));
    expect(ids).toEqual(['customizable', 'manifold', 'sdf', 'scad', 'brep']);

    // Every section has a heading, a numeric count, a descriptive blurb, and at
    // least one tile.
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const sec = sections.nth(i);
      await expect(sec.locator('h2')).toBeVisible();
      await expect(sec.locator('h2 + span')).toHaveText(/^\d+$/);
      await expect(sec.locator('p')).not.toBeEmpty();
      expect(await sec.locator('div.grid > button').count()).toBeGreaterThan(0);
    }
  });

  test('the Customizable section holds the parametric models and tags them', async ({ page }) => {
    await gotoCatalog(page);

    const customizable = page.locator('#catalog-page section[data-category="customizable"]');
    const tiles = customizable.locator('div.grid > button');
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThan(0);

    // Every tile in the Customizable section carries the parametric badge…
    await expect(customizable.locator('span:has-text("Parametric")')).toHaveCount(tileCount);

    // …and the parametric badge appears ONLY inside the Customizable section
    // (parametric is the trait that defines membership).
    const totalBadges = await page.locator('#catalog-page span:has-text("Parametric")').count();
    expect(totalBadges).toBe(tileCount);

    // A known parametric entry lives here, not in a language bucket.
    await expect(customizable).toContainText('Layer Cake');
  });

  test('clicking a tile imports the session and opens the editor', async ({ page }) => {
    await gotoCatalog(page);
    const firstTile = page.locator('#catalog-page section[data-category] div.grid > button').first();
    await expect(firstTile).toBeEnabled();
    await firstTile.click();
    await expect(page).toHaveURL(/\/editor/, { timeout: 20_000 });
  });
});
