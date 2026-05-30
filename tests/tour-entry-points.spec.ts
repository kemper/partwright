import { test, expect } from 'playwright/test';

// The guided tour can be (re)launched explicitly from two discoverable entry
// points: a "Take the guided tour" CTA on the landing page, and a "Guided tour"
// item (#btn-tour) in the editor's activity rail. (It also auto-starts on a
// first visit — suppressed here so we exercise the buttons, not the auto-start.)

test.describe('Guided tour entry points', () => {
  test('rail button (#btn-tour) starts the tour in the editor', async ({ page }) => {
    // Suppress the automatic first-visit tour so the only thing that can open
    // the overlay is our click. The rail button resets + restarts regardless.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });

    await page.goto('/editor');
    const tourBtn = page.locator('#btn-tour');
    await expect(tourBtn).toBeVisible();
    // Auto-start is suppressed, so no overlay until we click.
    await expect(page.locator('.tour-tooltip')).toHaveCount(0);

    await tourBtn.click();

    const tooltip = page.locator('.tour-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 30000 });
    await expect(tooltip).toContainText('Code Editor');
    await expect(tooltip.getByRole('button', { name: 'Next' })).toBeVisible();

    // Skip tears the overlay down.
    await tooltip.getByRole('button', { name: 'Skip' }).click();
    await expect(page.locator('.tour-tooltip')).toHaveCount(0);
  });

  test('landing CTA opens the editor and starts the tour', async ({ page }) => {
    await page.goto('/');
    // Scope to the landing subtree: the editor chrome (mounted but hidden in
    // the same SPA DOM) carries a rail button #btn-tour with the same
    // accessible name, so an unscoped getByRole can resolve to that hidden
    // control on slower startups and time out waiting for it to be clickable.
    const cta = page.locator('#landing-page').getByRole('button', { name: 'Take the guided tour' });
    await expect(cta).toBeVisible();

    await cta.click();

    // It routes into the editor and launches the tour there.
    await expect(page).toHaveURL(/\/editor/, { timeout: 30000 });
    const tooltip = page.locator('.tour-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 30000 });
    await expect(tooltip).toContainText('Code Editor');
  });
});
