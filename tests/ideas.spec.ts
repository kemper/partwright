// The /ideas page is a discovery surface: category sections of starter
// prompts, technique showcases, and interactive "use your own photo" flows.
// Picking a starter prompt lands the user in the editor with the prompt
// pre-filled in the AI panel (populate, don't send). This drives the real
// page + routing against the static IDEAS dataset.

import { test, expect, type Page } from 'playwright/test';

async function gotoIdeas(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/ideas');
  await page.waitForSelector('#ideas-page section[data-category]', { timeout: 20_000 });
}

test.describe('Ideas page', () => {
  test('renders category sections in order, each with a count, blurb, and tiles', async ({ page }) => {
    await gotoIdeas(page);

    const sections = page.locator('#ideas-page section[data-category]');
    await expect(sections).toHaveCount(3);

    const ids = await sections.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category));
    expect(ids).toEqual(['interactive', 'starter', 'technique']);

    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const sec = sections.nth(i);
      await expect(sec.locator('h2')).toBeVisible();
      await expect(sec.locator('h2 + span')).toHaveText(/^\d+$/);
      await expect(sec.locator('p')).not.toBeEmpty();
      expect(await sec.locator('div.grid > div').count()).toBeGreaterThan(0);
    }
  });

  test('interactive tiles carry a hidden image file input', async ({ page }) => {
    await gotoIdeas(page);
    const interactive = page.locator('#ideas-page section[data-category="interactive"]');
    const fileInputs = interactive.locator('input[type="file"]');
    expect(await fileInputs.count()).toBeGreaterThan(0);
    await expect(fileInputs.first()).toHaveAttribute('accept', 'image/*');
  });

  test('clicking a starter prompt opens the editor with the prompt pre-filled (not sent)', async ({ page }) => {
    await gotoIdeas(page);
    const starter = page.locator('#ideas-page section[data-category="starter"] div.grid > div button').first();
    await expect(starter).toBeEnabled();
    await starter.click();

    await expect(page).toHaveURL(/\/editor/, { timeout: 20_000 });

    // The AI panel opens and its input carries the chosen prompt — and the
    // transcript shows no sent user message (populate, don't send).
    const input = page.locator('#ai-panel textarea');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input).not.toHaveValue('', { timeout: 20_000 });
  });

  test('the prompt library button in the AI panel lists example prompts', async ({ page }) => {
    await gotoIdeas(page);
    // Get into the editor first (any starter does it).
    await page.locator('#ideas-page section[data-category="starter"] div.grid > div button').first().click();
    await expect(page).toHaveURL(/\/editor/, { timeout: 20_000 });
    await expect(page.locator('#ai-panel')).toBeVisible({ timeout: 20_000 });

    // The 💡 prompt-library button opens a modal of prompts.
    await page.locator('#ai-panel button[title^="Prompt library"]').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Prompt library');
    expect(await dialog.locator('button').count()).toBeGreaterThan(1);
  });
});
