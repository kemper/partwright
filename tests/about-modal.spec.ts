import { test, expect } from 'playwright/test';

// Verifies the toolbar ⓘ "About" button opens a dialog that reports the build
// the page is running (environment / branch / commit / build time), so a
// Cloudflare branch or PR preview can be traced to a commit.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('About / build info', () => {
  test('toolbar button opens the About modal with build metadata', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-about');

    await page.locator('#btn-about').click();
    await expect(page.getByRole('heading', { name: 'About Partwright' })).toBeVisible();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toContainText('Environment');
    await expect(modal).toContainText('Branch');
    await expect(modal).toContainText('Commit');
    await expect(modal).toContainText('Built');

    // The commit value renders something (a short SHA from git, or 'unknown').
    const commit = page.locator('#about-commit');
    await expect(commit).toBeVisible();
    await expect(commit).not.toHaveText('');

    // The copy-to-clipboard affordance is present.
    await expect(modal.getByRole('button', { name: /Copy/ })).toBeVisible();
  });

  test('Done closes the modal', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-about');

    await page.locator('#btn-about').click();
    await expect(page.getByRole('heading', { name: 'About Partwright' })).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'About Partwright' })).toHaveCount(0);
  });
});
