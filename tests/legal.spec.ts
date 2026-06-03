import { test, expect } from 'playwright/test';

// The /legal route is a pre-rendered, app-free static page (served by
// _redirects → legal.html on Cloudflare; by the dev/preview middleware
// locally). Direct navigation gets the static page; the editor still
// soft-renders an in-app copy from the same content source.

test.describe('Legal page (static)', () => {
  test('renders directly at /legal with the expected sections, app-free', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.getByRole('heading', { name: 'Legal', level: 1 })).toBeVisible();
    const main = page.locator('main');
    await expect(main).toContainText('Privacy');
    await expect(main).toContainText('no warranty');
    await expect(main).toContainText('Only run or import code from sources you trust');
    await expect(main).toContainText('PolyForm Noncommercial');
    await expect(page).toHaveTitle(/Legal & Privacy — Partwright/);
    // Canonical points at the clean route for crawlers.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/legal$/);
    // The app bundle never boots on this route.
    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);
    await expect(page.locator('#ai-panel')).toHaveCount(0);
  });

  test('is reachable from the landing-page footer', async ({ page }) => {
    await page.goto('/');
    const legalLink = page.locator('footer a', { hasText: 'Legal' });
    await expect(legalLink).toBeVisible();
    await legalLink.click();
    await expect(page).toHaveURL(/\/legal$/);
    await expect(page.getByRole('heading', { name: 'Legal', level: 1 })).toBeVisible();
  });

  test('the nav "Open editor" CTA navigates into the app', async ({ page }) => {
    await page.goto('/legal');
    await page.getByRole('link', { name: /Open editor/i }).click();
    await expect(page).toHaveURL(/\/editor(\?.*)?$/, { timeout: 30000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
  });

  test('an unknown path still 404s (legal allowlist is exact)', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/legalish');
    // The SPA 404 renders (the static legal page is not served for this path).
    await expect(page.locator('body')).toContainText(/not found/i);
  });
});
