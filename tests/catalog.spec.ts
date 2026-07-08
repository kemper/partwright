// The /catalog page is pre-rendered as an app-free static page at build time
// (from the manifest + payloads in public/catalog/), grouped into category
// sections (Customizable, JavaScript, SDF, Voxel, OpenSCAD, BREP) with parametric
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
    await expect(sections).toHaveCount(9);

    // The additive Print-Tested showcase leads; then curated groups (fidget-toys,
    // print-fit); then the engine-derived categories.
    const ids = await sections.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category));
    expect(ids).toEqual(['print-tested', 'fidget-toys', 'print-fit', 'customizable', 'manifold', 'sdf', 'voxel', 'scad', 'brep']);

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
    // Every customizable tile is parametric. Parametric badges may also appear in
    // curated groups (fidget-toys, print-fit) and in the additive Print-Tested
    // showcase (which duplicates tested tiles), but nowhere else — so the
    // page-wide badge total equals those sections' badge counts combined.
    const fidget = page.locator('main section[data-category="fidget-toys"]');
    const fidgetBadges = await fidget.locator('span:has-text("Parametric")').count();
    const printFit = page.locator('main section[data-category="print-fit"]');
    const printFitBadges = await printFit.locator('span:has-text("Parametric")').count();
    const tested = page.locator('main section[data-category="print-tested"]');
    const testedBadges = await tested.locator('span:has-text("Parametric")').count();
    const totalBadges = await page.locator('main span:has-text("Parametric")').count();
    expect(totalBadges).toBe(tileCount + fidgetBadges + printFitBadges + testedBadges);

    await expect(customizable).toContainText('Layer Cake');
  });

  test('the curated Fidget Toys group leads the categories and holds the mechanical fidget(s)', async ({ page }) => {
    await gotoCatalog(page);

    // The Print-Tested showcase is pinned first; fidget-toys leads the real categories.
    const sections = page.locator('main section[data-category]');
    await expect(sections.nth(1)).toHaveAttribute('data-category', 'fidget-toys');

    const fidget = page.locator('main section[data-category="fidget-toys"]');
    await expect(fidget.locator('h2')).toHaveText('Fidget Toys');
    // Currently one verified print-in-place mechanism (the spiral cone); the
    // remaining fidgets are being rebuilt as mechanisms in follow-up work.
    expect(await fidget.locator('div.grid > a').count()).toBe(1);
    await expect(fidget).toContainText('Spiral Fidget Cone');
  });

  test('every tile carries a print-tested status chip', async ({ page }) => {
    await gotoCatalog(page);

    const tiles = page.locator('main a[data-catalog-tile]');
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThan(0);

    // Each tile shows exactly one print-status chip — verified or untested.
    for (const tile of await tiles.all()) {
      const chips = tile.locator('span:has-text("Print-tested"), span:has-text("Untested")');
      await expect(chips).toHaveCount(1);
    }

    // The two states partition every tile: (# verified) + (# untested) == tileCount.
    const testedCount = await page.locator('main a[data-catalog-tile] span:has-text("Print-tested")').count();
    const untestedCount = await page.locator('main a[data-catalog-tile] span:has-text("Untested")').count();
    expect(testedCount + untestedCount).toBe(tileCount);
    // At least one entry is marked print-tested (the curated verified set).
    expect(testedCount).toBeGreaterThan(0);

    // A verified entry's chip carries its curator note in the hover tooltip.
    // (Tested entries appear twice — the top showcase + their home category — so
    // scope to the first match.)
    const manor = page.locator('main a[data-catalog-tile]', { hasText: 'Country Manor Estate' }).first();
    await expect(manor.locator('span:has-text("Print-tested")')).toHaveAttribute('title', /really cleanly/i);

    // The status is searchable: filtering on "untested" keeps only untested tiles.
    const search = page.locator('[data-catalog-search]');
    await search.fill('untested');
    const visible = await page.locator('main a[data-catalog-tile]:not(.hidden)').count();
    expect(visible).toBe(untestedCount);
    await search.fill('');
  });

  test('a Print-Tested showcase leads the catalog, duplicating tested entries above their home category', async ({ page }) => {
    await gotoCatalog(page);

    // The first section is the additive Print-Tested showcase.
    const first = page.locator('main section[data-category]').first();
    await expect(first).toHaveAttribute('data-category', 'print-tested');
    await expect(first.locator('h2')).toHaveText('Print-Tested');

    // It holds exactly the verified entries — every tile in it is tested.
    const showcaseTiles = first.locator('div.grid > a[data-catalog-tile]');
    const showcaseCount = await showcaseTiles.count();
    expect(showcaseCount).toBeGreaterThan(0);
    for (const tile of await showcaseTiles.all()) {
      await expect(tile).toHaveAttribute('data-status', 'tested');
    }

    // A tested entry is ALSO shown in its home category below — so it appears in
    // at least two sections (the showcase + its category).
    const manorEverywhere = page.locator('main a[data-catalog-tile]', { hasText: 'Country Manor Estate' });
    expect(await manorEverywhere.count()).toBeGreaterThanOrEqual(2);
    // One of those is inside the showcase, at least one is not.
    expect(await first.locator('a[data-catalog-tile]', { hasText: 'Country Manor Estate' }).count()).toBe(1);
  });

  test('print-status filter pill narrows to tested (or untested) tiles', async ({ page }) => {
    await gotoCatalog(page);

    const tiles = page.locator('main a[data-catalog-tile]');
    const tileCount = await tiles.count();
    const testedCount = await page.locator('main a[data-catalog-tile] span:has-text("Print-tested")').count();

    // The "✓ Print-tested" pill filters the whole catalog down to verified tiles.
    const testedPill = page.locator('[data-catalog-status="tested"]');
    await expect(testedPill).toBeVisible();
    await testedPill.click();
    const visibleTested = page.locator('main a[data-catalog-tile]:not(.hidden)');
    await expect(visibleTested).toHaveCount(testedCount);
    for (const tile of await visibleTested.all()) {
      await expect(tile).toHaveAttribute('data-status', 'tested');
    }

    // Clicking it again clears the facet — back to the full catalog.
    await testedPill.click();
    await expect(page.locator('main a[data-catalog-tile]:not(.hidden)')).toHaveCount(tileCount);
  });

  test('search narrows tiles, updates section counts, and hides empty sections', async ({ page }) => {
    await gotoCatalog(page);

    const search = page.locator('[data-catalog-search]');
    await expect(search).toBeVisible();
    await search.fill('cube');

    // Every visible tile matches the query; non-matching are hidden.
    const visibleTiles = page.locator('main a[data-catalog-tile]:not(.hidden)');
    expect(await visibleTiles.count()).toBeGreaterThan(0);
    for (const hay of await visibleTiles.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.search ?? ''))) {
      expect(hay).toContain('cube');
    }

    // Each visible section's count badge equals its visible-tile count; sections
    // with no matches are hidden.
    for (const sec of await page.locator('main section[data-category]').all()) {
      const visible = await sec.locator('a[data-catalog-tile]:not(.hidden)').count();
      if (visible === 0) {
        await expect(sec).toBeHidden();
      } else {
        await expect(sec.locator('[data-catalog-count]')).toHaveText(String(visible));
      }
    }

    // Clearing the search restores everything.
    await search.fill('');
    expect(await page.locator('main a[data-catalog-tile]:not(.hidden)').count()).toBeGreaterThan(10);
  });

  test('language pills are unselected by default and select to focus one language', async ({ page }) => {
    await gotoCatalog(page);

    const scadPill = page.locator('[data-catalog-pill="scad"]');
    // Unselected by default — no language filter, every language shows.
    await expect(scadPill).toHaveAttribute('aria-pressed', 'false');
    const jsBefore = await page.locator('main a[data-language="manifold-js"]:not(.hidden)').count();
    expect(jsBefore).toBeGreaterThan(0);

    // Selecting SCAD focuses on it: SCAD tiles show, other languages hide.
    await scadPill.click();
    await expect(scadPill).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('main a[data-language="scad"]:not(.hidden)').count()).toBeGreaterThan(0);
    await expect(page.locator('main a[data-language="manifold-js"]:not(.hidden)')).toHaveCount(0);

    // Unselecting returns to the default — all languages shown again.
    await scadPill.click();
    await expect(scadPill).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('main a[data-language="manifold-js"]:not(.hidden)').count()).toBe(jsBefore);
  });

  test('a theme pill filters to entries tagged with that theme', async ({ page }) => {
    await gotoCatalog(page);

    const figuresPill = page.locator('[data-catalog-theme="figures"]');
    await expect(figuresPill).toHaveAttribute('aria-pressed', 'false');
    await figuresPill.click();
    await expect(figuresPill).toHaveAttribute('aria-pressed', 'true');

    // Every visible tile carries the figures theme; nothing untagged shows.
    const visible = page.locator('main a[data-catalog-tile]:not(.hidden)');
    expect(await visible.count()).toBeGreaterThan(0);
    for (const themes of await visible.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.themes ?? ''))) {
      expect(themes.split(/\s+/)).toContain('figures');
    }

    // Clearing the pill restores the full catalog.
    await figuresPill.click();
    await expect(figuresPill).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('main a[data-catalog-tile]:not(.hidden)').count()).toBeGreaterThan(20);
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

    // The in-app overlay carries the same search + filter surface, wired live.
    const search = page.locator('#catalog-page [data-catalog-search]');
    await expect(search).toBeVisible();
    await search.fill('zzzznomatchzzzz');
    await expect(page.locator('#catalog-page [data-catalog-empty]')).toBeVisible();
    await expect(page.locator('#catalog-page a[data-catalog-tile]:not(.hidden)')).toHaveCount(0);
  });

  test('rapid re-navigation to the catalog renders a single pane (no split view)', async ({ page }) => {
    // Regression: createCatalogPage awaits a manifest fetch before returning, so
    // the `if (!catalogEl)` guard stayed null across the await. Rapid re-entry
    // (a double-click, or the popstate a pushState fires) bypassed it and
    // appended a second/third #catalog-page, stacking duplicate catalog panes.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, { timeout: 30_000 });

    // Fire several route syncs back-to-back, faster than the manifest fetch
    // resolves — the same concurrency a rapid double/triple click produces.
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) {
        window.history.pushState({}, '', '/catalog');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });

    await expect(page.locator('#catalog-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#catalog-page')).toHaveCount(1);
  });
});
