import { test, expect } from 'playwright/test';

// Coverage for the /legal route: direct load, footer link, in-page Back, and 404.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Legal page', () => {
  test('renders directly at /legal with the expected sections', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.locator('#legal-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Legal', level: 1 })).toBeVisible();
    // Each of the three documented sections is present.
    await expect(page.locator('#legal-page')).toContainText('Privacy');
    await expect(page.locator('#legal-page')).toContainText('no warranty');
    await expect(page.locator('#legal-page')).toContainText('Only run or import code from sources you trust');
    // License is named explicitly.
    await expect(page.locator('#legal-page')).toContainText('PolyForm Noncommercial');
    // The document title reflects the route (the title guard keeps it stable).
    await expect(page).toHaveTitle(/Legal — Partwright/);
  });

  test('is reachable from the landing-page footer', async ({ page }) => {
    await page.goto('/');
    const legalLink = page.locator('footer a', { hasText: 'Legal' });
    await expect(legalLink).toBeVisible();
    await legalLink.click();
    await expect(page).toHaveURL(/\/legal$/);
    await expect(page.locator('#legal-page')).toBeVisible();
  });

  test('Back returns to the editor', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.locator('#legal-page')).toBeVisible();
    await page.locator('#legal-page button', { hasText: 'Back' }).click();
    // The editor's code pane is shown and we're back on the editor route. A
    // fresh editor visit restores/creates a session, so the URL may gain a
    // ?session= suffix — match the route with or without it (a strict /editor$
    // raced the session param being appended right after Back).
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page).toHaveURL(/\/editor(\?.*)?$/);
  });

  test('an unknown path still 404s (legal allowlist is exact)', async ({ page }) => {
    await page.goto('/legalish');
    // The 404 page renders, not the legal page.
    await expect(page.locator('#legal-page')).toHaveCount(0);
    await expect(page.locator('body')).toContainText(/not found/i);
  });
});
