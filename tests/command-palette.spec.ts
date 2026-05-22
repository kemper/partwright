// Command palette (⌘K / Ctrl+K) and the `?` keyboard cheat sheet.
//
// `ControlOrMeta` maps the press to ⌘ on macOS and Ctrl elsewhere, mirroring
// the app's own OS detection. The first-run tour is pre-dismissed via the
// localStorage flag so its backdrop/keys don't interfere.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
}

test.describe('command palette', () => {
  test('opens with the palette key and runs a command by name', async ({ page }) => {
    await openEditor(page);

    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('input[aria-label="Search commands"]');
    await expect(input).toBeVisible();

    await input.fill('notes');
    await expect(page.locator('[role="option"]').filter({ hasText: 'Go to Notes' })).toBeVisible();

    await page.keyboard.press('Enter');

    // Palette closed, and the Notes tab is now active (URL carries ?notes).
    await expect(input).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.has('notes')).toBe(true);
  });

  test('filters out and hides unavailable rows', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('input[aria-label="Search commands"]');
    await input.fill('zzzznotacommand');
    await expect(page.getByText('No matching commands')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
  });

  test('the ? key opens the keyboard cheat sheet', async ({ page }) => {
    await openEditor(page);
    // Move focus out of the code editor so `?` isn't typed as a literal.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await page.keyboard.press('Shift+Slash');
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  });

  test('shows a one-time hint toward the ? cheat sheet once the tour is done', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('partwright-tour-completed', new Date().toISOString());
        localStorage.removeItem('partwright-shortcuts-hint-seen');
      } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await expect(
      page.locator('div[role="status"]').filter({ hasText: /keyboard shortcuts/i }),
    ).toBeVisible({ timeout: 6000 });
  });
});
