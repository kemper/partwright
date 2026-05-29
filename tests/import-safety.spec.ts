// E2E for the import-preview code-execution warning and the Gemini
// key-in-URL note. No external network.

import { test, expect, type Page } from 'playwright/test';

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('Import safety note', () => {
  test('the import-preview modal warns about code execution before confirming', async ({ page }) => {
    await openEditor(page);

    // Build a real payload via the export API, then drive the UI import path
    // (the console API path bypasses showImportPreview by design).
    const json = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (c: string, l?: string) => Promise<unknown>;
        exportSessionData: (id: string) => Promise<{ data: unknown }>;
        currentSessionId?: () => string | null;
      } }).partwright;
      await pw.createSession('to-export');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([8,8,8], true);', 'v1');
      const sid = new URLSearchParams(window.location.search).get('session')!;
      const { data } = await pw.exportSessionData(sid);
      return JSON.stringify(data);
    });

    // Drop the file onto the hidden toolbar import input.
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'shared.partwright.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json, 'utf8'),
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await expect(dialog).toContainText('Import session');
    // The code-execution warning is present BEFORE the user confirms.
    await expect(dialog).toContainText('runs each version’s code in your browser');
    await expect(dialog).toContainText('Only import sessions from sources you trust');

    // Cancel — nothing is imported.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Gemini key note', () => {
  test('the Gemini connect modal explains the key travels in the URL', async ({ page }) => {
    await openEditor(page);

    // Open the Gemini key modal directly via the exported helper (avoids
    // depending on the toolbar→provider navigation).
    await page.evaluate(async () => {
      const mod = await import('/src/ui/aiKeyModal.tsx');
      (mod as { showAiKeyModal: (cb: { onConnected: () => void; provider?: string }) => void })
        .showAiKeyModal({ onConnected: () => {}, provider: 'gemini' });
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await expect(dialog).toContainText('Connect Google Gemini');
    await expect(dialog).toContainText('key as a URL query parameter');
  });
});
