// E2E coverage for editor draft autosave. Typing into the editor, then the tab
// going hidden (or going idle), persists the working buffer as a draft keyed by
// (session, language). On reopening the session that draft is restored ahead of
// the last saved version, so an accidental reload / crash doesn't lose unsaved
// work. Runs with no external network.

import { test, expect, type Page } from 'playwright/test';

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('partwright-tour-completed', '1');
      // Keep the code pane visible (the AI drawer otherwise collapses it).
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
    } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

async function replaceEditorWith(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 5 });
}

const SAVED = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
// A distinctive draft that is NOT saved as a version.
const DRAFT = 'const { Manifold } = api; return Manifold.sphere(7, 32); // DRAFT-MARKER-42';

test.describe('editor autosave', () => {
  test('restores an autosaved draft after a reload', async ({ page }) => {
    await openEditor(page);

    // Seed a session with one saved version (so the reopen baseline is the
    // saved code, not the draft).
    const sessionId = await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (c: string, l?: string) => Promise<unknown>;
        currentSessionId?: () => string | null;
      } }).partwright;
      await pw.createSession('autosave-test');
      await pw.runAndSave(code, 'v1');
      // Pull the session id out of the URL the app maintains.
      return new URLSearchParams(window.location.search).get('session');
    }, SAVED);
    expect(sessionId).toBeTruthy();

    // Type an unsaved draft and wait past the idle autosave window (800ms).
    await replaceEditorWith(page, DRAFT);
    await page.waitForTimeout(1100);

    // Simulate the tab being backgrounded — fires the visibilitychange
    // autosave (best-effort persist before the page may go away).
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Give the async IDB write a beat to commit.
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    // The editor should show the DRAFT, not the saved v1 code.
    await expect(page.locator('.cm-content')).toContainText('DRAFT-MARKER-42', { timeout: 10_000 });
  });
});
