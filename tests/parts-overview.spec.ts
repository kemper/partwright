import { test, expect } from 'playwright/test';

// Parts overview — the ▦ contact-sheet modal over the part list. Golden path:
// a session with two parts shows two tiles (thumbnails, no rebuilds), and
// clicking a tile switches the active part.
test.describe('Parts overview', () => {
  test('shows a tile per part and switches on click', async ({ page }) => {
    test.setTimeout(180_000);
    // Suppress the first-run guided tour — its backdrop intercepts clicks.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.runAndSave);

    // Build a two-part session through the console API (waits out WASM warmup
    // the same way build-catalog-entry.cjs does).
    const setup = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      let warmed = false;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
        if (p && !p.error && p.version) { warmed = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!warmed) return { error: 'engine warmup timeout' };
      await pw.createSession('overview spec');
      await pw.renamePart(0, 'cube part');
      const r1 = await pw.runAndSave('return api.Manifold.cube([5, 5, 5], true);', 'v0', {});
      await pw.createPart('sphere part');
      const r2 = await pw.runAndSave('return api.Manifold.sphere(3, 32);', 'v0', {});
      return { e1: r1?.error, e2: r2?.error };
    });
    expect(setup).toEqual({ e1: undefined, e2: undefined });

    await page.locator('#btn-parts-overview').click();
    const tiles = page.locator('[data-overview-tile]');
    await expect(tiles).toHaveCount(2);
    // Thumbnails come from saved versions — both parts were run, so both
    // tiles should get an <img> (no placeholder text left).
    await expect(tiles.first().locator('img')).toBeVisible();
    await expect(tiles.nth(1).locator('img')).toBeVisible();

    // Clicking the first tile closes the modal and switches to that part.
    await tiles.first().click();
    await expect(page.locator('[data-overview-tile]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as any).partwright.getCurrentPart()?.name), { timeout: 20_000 })
      .toBe('cube part');
  });
});
