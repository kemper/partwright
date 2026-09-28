import { test, expect } from 'playwright/test';

// Golden path for the in-app feedback surface: the toolbar button opens the
// dialog, and every option is an external GitHub link (nothing is sent from
// the app). The bug-report link carries the build version and drops the page
// hash, which can hold a whole shared design.
test.describe('Feedback dialog', () => {
  // Suppress the first-visit guided tour — its backdrop would intercept clicks.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('toolbar button opens GitHub feedback links', async ({ page }) => {
    await page.goto('/editor#private-design-payload');
    const btn = page.locator('#btn-feedback');
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await btn.click();

    await expect(page.getByText('Send feedback', { exact: true })).toBeVisible();

    const bug = page.locator('#feedback-bug');
    const href = await bug.getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/new$/);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('version')).toBeTruthy();
    expect(url.searchParams.get('environment')).toContain('/editor');
    expect(href).not.toContain('private-design-payload');
    await expect(bug).toHaveAttribute('target', '_blank');

    await expect(page.locator('#feedback-feature')).toHaveAttribute('href', /template=feature_request\.yml/);
    await expect(page.locator('#feedback-question')).toHaveAttribute('href', /\/discussions\/new\?category=q-a$/);
    await expect(page.locator('#feedback-show')).toHaveAttribute('href', /\/discussions\/new\?category=show-and-tell$/);

    if (process.env.FEEDBACK_SCREENSHOT) {
      await page.screenshot({ path: process.env.FEEDBACK_SCREENSHOT });
    }
  });
});
