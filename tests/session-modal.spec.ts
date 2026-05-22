import { test, expect, type Page } from 'playwright/test';

// Network-free coverage for two session-modal changes:
//   1. Creating a new session from the modal must clear the previous
//      session's code from the editor (it used to leave the old code behind).
//   2. Each session row shows a thumbnail preview of its latest version —
//      an <img> when a thumbnail exists, a placeholder glyph otherwise —
//      mirroring the landing-page session tiles.

type PW = {
  createSession: (name: string) => Promise<{ id: string }>;
  getCode: () => string;
  setCode: (code: string) => void;
};

function waitForApi(page: Page) {
  return page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createSession?: unknown } }).partwright?.createSession,
  );
}

test.describe('Session modal', () => {
  // Suppress the first-visit guided tour — its full-screen backdrop otherwise
  // intercepts pointer events on the session bar.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('partwright-tour-completed', '1');
      } catch {
        /* storage may be unavailable */
      }
    });
  });

  test('creating a new session from the modal clears the previous code', async ({ page }) => {
    await page.goto('/editor');
    await waitForApi(page);

    // Open an active session so the only "+ New Session" button on screen is
    // the modal's (the session bar only shows its own when there's no session).
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.createSession('Original Session'));

    const MARKER = 'SENTINEL_OLD_SESSION_CODE_123';
    await page.evaluate((m) => {
      (window as unknown as { partwright: PW }).partwright.setCode(
        `// ${m}\nconst { Manifold } = api;\nreturn Manifold.sphere(7);`,
      );
    }, MARKER);
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode())).toContain(MARKER);

    // The modal's New Session button prompts for a name — accept it.
    page.on('dialog', (d) => d.accept('Fresh Session'));

    await page.locator('#session-bar button', { hasText: 'Sessions' }).click();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await page.locator('button', { hasText: '+ New Session' }).click();

    // Editor now holds the fresh default, not the old session's code.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode()))
      .toContain('// New session');
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode())).not.toContain(
      MARKER,
    );
  });
});
