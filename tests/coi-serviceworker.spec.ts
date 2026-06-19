// Guards against the COI service-worker script silently breaking on load.
//
// `public/coi-serviceworker.js` is loaded as a CLASSIC <script src> (not a
// module). A regression (#547) made it reference `import.meta.url`, which is a
// PARSE-TIME SyntaxError in a classic script — discarding the whole file, so the
// cross-origin-isolation service worker never registered/updated and every page
// load threw "Cannot use 'import.meta' outside a module". That error is invisible
// to the type checker and to a fresh app boot (the page still works when COOP/COEP
// arrive via _headers), so it shipped. This test catches that class of regression
// by asserting the content pages and the editor load with no uncaught page error.

import { test, expect, type Page } from 'playwright/test';

async function pageErrorsOnLoad(page: Page, route: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(route);
  await page.waitForTimeout(2500);
  return errors;
}

test.describe('COI service worker', () => {
  test('the editor loads with no uncaught page error (coi-serviceworker parses)', async ({ page }) => {
    const errors = await pageErrorsOnLoad(page, '/editor');
    expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the catalog page loads with no uncaught page error', async ({ page }) => {
    const errors = await pageErrorsOnLoad(page, '/catalog');
    expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('clicking a catalog tile opens the editor, not the landing page', async ({ page }) => {
    await page.goto('/catalog');
    await page.waitForTimeout(1500);
    await page.locator('[data-catalog-tile]').first().click();
    // The catalog deep-link imports the entry and rewrites to ?session=…; the
    // editor must be present and the inline landing hero must NOT be showing.
    await expect(page.locator('.cm-editor, #code-editor').first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/editor\?/);
    expect(await page.locator('#landing-inline').isVisible().catch(() => false)).toBe(false);
  });
});
