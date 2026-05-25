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

    await page.locator('#btn-sessions').click();
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

  test('session rows render a thumbnail preview', async ({ page }) => {
    await page.goto('/editor');
    await waitForApi(page);

    const withThumb = await page.evaluate(
      async () => (await (window as unknown as { partwright: PW }).partwright.createSession('Thumb Session')).id,
    );
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.createSession('Empty Session'));

    // Seed a saved version carrying a real 1×1 PNG thumbnail for the first
    // session, straight into IndexedDB so the assertion doesn't depend on WebGL.
    await page.evaluate(async (sessionId) => {
      // Build the Blob from base64 directly — the app's CSP blocks fetch('data:').
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('partwright');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('versions', 'readwrite');
      tx.objectStore('versions').put({
        id: 'seed-thumb-v1',
        sessionId,
        index: 1,
        code: 'return Manifold.cube([1,1,1]);',
        geometryData: null,
        thumbnail: blob,
        label: 'v1',
        timestamp: Date.now(),
      });
      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    }, withThumb);

    await page.locator('#btn-sessions').click();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // The seeded session shows its thumbnail as an <img>; the version-less one
    // falls back to the placeholder glyph.
    await expect(page.locator('img[alt="Thumb Session"]')).toBeVisible();
    await expect(page.getByText('⬡').first()).toBeVisible();
  });
});
