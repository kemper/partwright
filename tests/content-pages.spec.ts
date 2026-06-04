import { test, expect } from 'playwright/test';

// The /help and /whats-new routes are pre-rendered, app-free static pages
// (Cloudflare _redirects → *.html; dev/preview middleware locally). They must
// carry real content + SEO metadata for crawlers without booting the app.

test.describe('Help page (static)', () => {
  test('renders the guide app-free with TOC + sections and correct metadata', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'How Partwright works', level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/How Partwright Works/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/help$/);

    const main = page.locator('main');
    // A few representative sections are present in the served HTML.
    await expect(main).toContainText('What is Partwright?');
    await expect(main).toContainText('Modeling engines & languages');
    await expect(main).toContainText('Keyboard shortcuts');
    // Table-of-contents anchor links resolve to in-page section ids.
    await expect(main.locator('nav a[href="#engines"]')).toBeVisible();
    await expect(main.locator('h2#engines')).toHaveCount(1);

    // App-free.
    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);
  });

  test('the guided-tour CTA links into the editor with ?tour=1', async ({ page }) => {
    await page.goto('/help');
    const cta = page.getByRole('link', { name: 'Take the guided tour' });
    await expect(cta).toHaveAttribute('href', '/editor?tour=1');
  });
});

test.describe("What's new page (static)", () => {
  test('renders the changelog app-free with weekly entries and metadata', async ({ page }) => {
    await page.goto('/whats-new');
    await expect(page.getByRole('heading', { name: 'What’s new', level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/What's New/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/whats-new$/);

    const main = page.locator('main');
    await expect(main).toContainText('Launch & foundations'); // oldest headline
    await expect(main).toContainText('Slash commands');       // newest week
    // Multiple week sections render.
    expect(await main.locator('section').count()).toBeGreaterThanOrEqual(4);

    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);
  });
});

test.describe('Shared content-page chrome', () => {
  // The header must be identical across every non-editor surface.
  const EXPECTED_LINKS = ['Ideas', 'Catalog', 'How it works', 'For AI agents', 'What’s new'];

  for (const route of ['/catalog', '/help', '/legal', '/whats-new']) {
    test(`the shared header is identical on ${route}`, async ({ page }) => {
      await page.goto(route);
      const header = page.locator('header.pw-header');
      await expect(header).toHaveCount(1);
      // Brand cluster: logo link home + "Partwright" wordmark + Beta pill.
      await expect(header.locator('a[aria-label="Partwright home"]')).toHaveAttribute('href', '/');
      await expect(header).toContainText('Partwright');
      await expect(header).toContainText('Beta');
      // The full, ordered nav-link set.
      const labels = await header.locator('nav.pw-navlinks a').allInnerTexts();
      expect(labels).toEqual(EXPECTED_LINKS);
      // The "Open editor" CTA.
      await expect(header.getByRole('link', { name: /Open editor/i })).toHaveAttribute('href', '/editor');
      // The header bar is sticky so it stays visible on scroll / anchor jumps.
      const pos = await page.locator('.pw-headerbar').evaluate((el) => getComputedStyle(el).position);
      expect(pos).toBe('sticky');
    });
  }

  test('nav cross-links between the static pages without booting the app', async ({ page }) => {
    await page.goto('/legal');
    await page.locator('header nav').getByRole('link', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'How Partwright works', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => 'partwright' in window)).toBe(false);
  });
});
