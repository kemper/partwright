// Live-error UX: auto-runs (typing) drive the preview but defer error surfacing
// so the editor doesn't flicker an error / move the caret on every keystroke.
// The error panel is a non-shifting overlay, and transient typing errors are
// kept out of the diagnostic log.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
}

async function replaceEditorWith(page: import('playwright/test').Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 10 });
}

// A distinctive runtime error so we can match it precisely in either panel.
const BAD = 'return zzznotdefined123;';

test.describe('editor live errors', () => {
  test('errors are deferred while typing, then surface once idle', async ({ page }) => {
    await openEditor(page);
    const panel = page.locator('#editor-error-panel');
    await replaceEditorWith(page, BAD);

    // Not surfaced on the keystroke, nor mid-window before the idle delay.
    await expect(panel).toBeHidden();
    await page.waitForTimeout(450);
    await expect(panel).toBeHidden();

    // Surfaces after typing settles.
    await expect(panel).toBeVisible({ timeout: 3000 });
    await expect(panel).toContainText('zzznotdefined123');
  });

  test('the error panel is an overlay (does not reflow the editor)', async ({ page }) => {
    await openEditor(page);
    const panel = page.locator('#editor-error-panel');
    await replaceEditorWith(page, BAD);
    await expect(panel).toBeVisible({ timeout: 3000 });
    await expect(panel).toHaveCSS('position', 'absolute');
  });

  test('transient typing errors stay out of the diagnostic log', async ({ page }) => {
    await openEditor(page);
    const panel = page.locator('#editor-error-panel');
    await replaceEditorWith(page, BAD);
    await expect(panel).toBeVisible({ timeout: 3000 });
    await expect(panel).toContainText('zzznotdefined123');

    await page.click('#btn-diagnostics');
    const diag = page.locator('#diagnostics-panel');
    await expect(diag).toBeVisible();
    await expect(diag).not.toContainText('zzznotdefined123');
  });
});
