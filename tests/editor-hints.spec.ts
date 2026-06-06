import { test, expect } from 'playwright/test';

// Golden path for the "Did you know?" hints ticker (src/ui/hints/*).
test.describe('editor hints ticker', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        // Suppress the first-run guided tour — its backdrop intercepts clicks.
        localStorage.setItem('partwright-tour-completed', '1');
        // Start with the AI panel closed so the toolbar's middle has room for
        // the inline ticker (it collapses responsively when space is tight).
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ drawerOpen: false }));
      } catch { /* ignore */ }
    });
  });

  test('shows, rotates, coaches, and dismisses', async ({ page }) => {
    await page.goto('/editor');

    const strip = page.locator('#editor-hints');
    await expect(strip).toBeVisible({ timeout: 15_000 });

    // Badge + a CTA link are present.
    await expect(strip).toContainText('Did you know?');
    const cta = strip.locator('button').filter({ hasText: '→' }).first();
    await expect(cta).toBeVisible();

    // The hint text is non-empty.
    const hintText = page.locator('#editor-hints-text');
    const first = (await hintText.textContent())?.trim() ?? '';
    expect(first.length).toBeGreaterThan(0);

    // The › arrow advances to a different hint.
    await strip.getByRole('button', { name: 'Next hint' }).click();
    await expect.poll(async () => (await hintText.textContent())?.trim()).not.toBe(first);

    await page.screenshot({ path: 'test-results/editor-hints.png' });

    // ✕ hides the strip for the session.
    await strip.getByRole('button', { name: /Hide hints/ }).click();
    await expect(strip).toHaveCount(0);
  });

  test('a new session restores hints dismissed with ✕', async ({ page }) => {
    await page.goto('/editor');
    const strip = page.locator('#editor-hints');
    await expect(strip).toBeVisible({ timeout: 15_000 });

    await strip.getByRole('button', { name: /Hide hints/ }).click();
    await expect(strip).toHaveCount(0);

    // Starting a different session means "✕ was just for that session".
    await page.evaluate(() =>
      (window as unknown as { partwright: { createSession: (n?: string) => Promise<unknown> } })
        .partwright.createSession('hints-test'),
    );
    await expect(strip).toBeVisible({ timeout: 8000 });
  });

  test('a coach CTA pulses an arrow at the target control', async ({ page }) => {
    await page.goto('/editor');
    const strip = page.locator('#editor-hints');
    await expect(strip).toBeVisible({ timeout: 15_000 });

    // Step to the BREP-engine hint, whose CTA coaches the language toggle.
    const hintText = page.locator('#editor-hints-text');
    let found = false;
    for (let i = 0; i < 12; i++) {
      const t = (await hintText.textContent())?.toLowerCase() ?? '';
      if (t.includes('brep')) { found = true; break; }
      await strip.getByRole('button', { name: 'Next hint' }).click();
    }
    expect(found).toBe(true);

    await strip.locator('button').filter({ hasText: '→' }).first().click();
    // The coachmark ring appears and points near the language toggle.
    await expect(page.locator('.pw-coachmark-ring')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.pw-coachmark-bubble')).toContainText('engine');
    await page.screenshot({ path: 'test-results/editor-hints-coach.png' });
  });
});
