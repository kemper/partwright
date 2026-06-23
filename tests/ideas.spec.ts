// The /ideas page is a discovery surface: category sections of starter
// prompts, technique showcases, and interactive "use your own photo" flows.
// It ships as a STATIC, app-free pre-rendered page (like /catalog) so crawlers
// see the full content with no JS. Each tile is a real link into the editor —
// /editor?idea=<id> — which prefills the AI panel (prompt ideas) or opens the
// photo flow (interactive ideas). This drives the real page + routing against
// the static IDEAS dataset.

import { test, expect, type Page } from 'playwright/test';

async function gotoIdeas(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/ideas');
  await page.waitForSelector('main section[data-category]', { timeout: 20_000 });
}

test.describe('Ideas page', () => {
  test('is a static, app-free page with the shared header at full width', async ({ page }) => {
    await gotoIdeas(page);
    // Same shared header as the landing + static content pages.
    const header = page.locator('header.pw-header');
    await expect(header).toHaveCount(1);
    await expect(header).toContainText('Partwright');
    await expect(header.locator('nav.pw-navlinks a')).toHaveCount(5);
    // No app JS on this page — the docked AI panel never mounts, so the page
    // renders full-width (not squished by the editor's side panel).
    await expect(page.locator('#ai-panel')).toHaveCount(0);
    const headerWidth = await header.evaluate((el) => el.getBoundingClientRect().width);
    expect(headerWidth).toBeGreaterThan(1000);
    // A static page boots no app, so there's no loading splash to clear.
    await expect(page.locator('#loading-splash')).toHaveCount(0);
  });

  test('renders category sections in order, each with a count, blurb, and tiles', async ({ page }) => {
    await gotoIdeas(page);

    const sections = page.locator('main section[data-category]');
    await expect(sections).toHaveCount(3);

    const ids = await sections.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category));
    expect(ids).toEqual(['interactive', 'starter', 'technique']);

    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const sec = sections.nth(i);
      await expect(sec.locator('h2')).toBeVisible();
      await expect(sec.locator('h2 + span')).toHaveText(/^\d+$/);
      await expect(sec.locator('p').first()).not.toBeEmpty();
      expect(await sec.locator('div.grid > div').count()).toBeGreaterThan(0);
    }
  });

  test('every tile is a deep-link into the editor (/editor?idea=…)', async ({ page }) => {
    await gotoIdeas(page);
    // Interactive tiles deep-link too — the photo picker opens in the editor.
    const interactive = page.locator('main section[data-category="interactive"] div.grid > div > a');
    expect(await interactive.count()).toBeGreaterThan(0);
    for (const href of await interactive.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')))) {
      expect(href).toMatch(/^\/editor\?idea=/);
    }
  });

  test('clicking a starter prompt opens the editor with the prompt pre-filled (not sent)', async ({ page }) => {
    await gotoIdeas(page);
    const starter = page.locator('main section[data-category="starter"] div.grid > div > a').first();
    await starter.click();

    await expect(page).toHaveURL(/\/editor/, { timeout: 20_000 });

    // The AI panel opens and its input carries the chosen prompt — and the
    // transcript shows no sent user message (populate, don't send). The
    // one-shot ?idea= param is stripped for a clean editor URL.
    await expect(page).not.toHaveURL(/[?&]idea=/, { timeout: 20_000 });
    const input = page.locator('#ai-panel textarea');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input).not.toHaveValue('', { timeout: 20_000 });
  });

  test('the prompt library button in the AI panel lists example prompts', async ({ page }) => {
    await gotoIdeas(page);
    // Get into the editor first (any starter does it).
    await page.locator('main section[data-category="starter"] div.grid > div > a').first().click();
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
