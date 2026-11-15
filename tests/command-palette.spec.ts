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

  test('the toolbar Search tools button opens a categorised browse view', async ({ page }) => {
    await openEditor(page);
    await page.locator('#btn-command-palette').click();
    const input = page.locator('input[aria-label="Search commands"]');
    await expect(input).toBeVisible();
    // Empty query browses by category, tool rows carry a one-line description.
    const list = page.locator('#cmd-palette-list');
    await expect(list.locator('[role="presentation"]').filter({ hasText: /^Tools$/ })).toBeVisible();
    await expect(list.getByText('Add a texture: fuzzy skin', { exact: false })).toBeVisible();
  });

  test('tolerates typos and remembers recently used actions', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('input[aria-label="Search commands"]');
    await input.fill('notse');
    await expect(page.locator('[role="option"]').first()).toContainText('Go to Notes');
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.has('notes')).toBe(true);

    await page.keyboard.press('ControlOrMeta+k');
    const list = page.locator('#cmd-palette-list');
    await expect(list.locator('[role="presentation"]').filter({ hasText: /^Recent$/ })).toBeVisible();
    await expect(page.locator('[role="option"]').first()).toContainText('Go to Notes');
  });

  test('a query can be handed to the AI chat', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('make it twice as tall');
    const ask = page.locator('[role="option"][data-fallback="true"]');
    await expect(ask).toContainText('Ask the AI');
    await ask.click();
    await expect(page.locator('#ai-panel textarea')).toHaveValue('make it twice as tall');
  });

  test('the Inspect menu ends with a search entry that opens the palette', async ({ page }) => {
    await openEditor(page);
    await page.locator('#viewport-inspect-group-btn').dispatchEvent('click');
    await page.locator('#viewport-inspect-search').click();
    await expect(page.locator('input[aria-label="Search commands"]')).toBeVisible();
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
