import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// A hosted model with no pricing data (e.g. newer than the deployed catalog
// snapshot, picked from the live model list) must never be billed at a
// guessed rate. The panel asks the user to authorize it before the first
// request, and turns on it show "cost unknown" instead of a dollar figure.

const UNPRICED_MODEL = 'gemini-99-flash-unreleased';

const geminiReply = 'data: ' + JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from an unpriced model.' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 20, totalTokenCount: 1220 },
}) + '\n\n';

test('unpriced model asks for authorization and reports cost unknown', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });

  let requests = 0;
  await page.route('**/v1beta/models/**', async (route) => {
    requests++;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: geminiReply });
  });

  await page.goto('/editor');
  await waitForEditorReady(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('partwright');
      open.onsuccess = () => {
        const db = open.result;
        const txn = db.transaction('aiKeys', 'readwrite');
        txn.objectStore('aiKeys').put({ provider: 'gemini', apiKey: 'AIza-test-0000', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
        txn.oncomplete = () => { db.close(); resolve(); };
        txn.onerror = () => reject(txn.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await waitForEditorReady(page);
  await page.evaluate(async (model) => {
    const s = await import('/src/ai/settings.ts');
    s.saveSettings(s.setGeminiModel(s.setProvider(s.loadSettings(), 'gemini'), model));
  }, UNPRICED_MODEL);
  await openAiPanel(page);
  const settings = page.getByRole('heading', { name: 'AI Settings' });
  if (await settings.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); }

  const input = page.locator('#ai-panel textarea');
  await input.fill('hello');
  await input.press('Enter');

  // Declining keeps the message unsent and makes no provider request.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Unknown model pricing' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(UNPRICED_MODEL);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(input).toHaveValue('hello');
  expect(requests).toBe(0);

  // Authorizing sends the turn; its cost is reported as unknown, not guessed.
  await input.press('Enter');
  await dialog.getByRole('button', { name: 'Continue without cost tracking' }).click();
  await expect(page.locator('#ai-panel')).toContainText('Hello from an unpriced model.', { timeout: 20_000 });
  await expect(page.locator('#ai-panel')).toContainText('cost unknown');
  await expect(page.locator('#ai-panel')).toContainText('session: ≥$0');
  await expect(page.locator('#ai-panel')).toContainText('done · cost unknown');
  await expect(page.getByText('Not sent', { exact: false })).toBeHidden();
  expect(requests).toBeGreaterThan(0);
});
