import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Regression: the AI Call Log (🩺) only showed the main-thread validateKey
// ping — never the chat turns. For hosted providers the chat loop runs inside
// the agent Worker, so its streamTurn diagnostics events landed in the
// Worker's own ring buffer, which the modal (main thread) never reads. The fix
// forwards Worker-recorded events to the main thread.
//
// This drives a real Anthropic turn through the Worker. There's no network in
// CI, so the provider request fails — but that failure is itself a streamTurn
// event recorded *inside the Worker* (chatLoop's catch path). Before the fix
// the log stayed empty; after it, the forwarded error row shows up. We assert
// the row appears, not that the request succeeded (per the no-network rule).

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

/** Plant a hosted-provider key straight into IndexedDB. The real connect flow
 *  hits api.anthropic.com (blocked in CI), so tests seed the key directly —
 *  the same trick the provider specs use. */
async function plantAnthropicKey(page: import('playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('partwright');
      open.onsuccess = () => {
        const db = open.result;
        const txn = db.transaction('aiKeys', 'readwrite');
        txn.objectStore('aiKeys').put({
          provider: 'anthropic',
          apiKey: 'sk-ant-test-planted-key-0000000000',
          createdAt: Date.now(),
          lastUsed: Date.now(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
        });
        txn.oncomplete = () => { db.close(); resolve(); };
        txn.onerror = () => reject(txn.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
}

test.describe('AI Call Log', () => {
  test('records streamTurn events from the agent Worker (hosted providers)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    // Connect Anthropic (the default provider) by seeding the key, then reload
    // so the panel boots in its connected state with the key resident.
    await plantAnthropicKey(page);
    await page.reload();
    await waitForEditorReady(page);

    await openAiPanel(page);
    // A stray AI Settings modal (auto-opened when the panel is toggled while
    // disconnected) would swallow our clicks — dismiss it if present.
    const settingsHeading = page.getByRole('heading', { name: 'AI Settings' });
    if (await settingsHeading.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(settingsHeading).toBeHidden();
    }

    // Fire a turn. provider=anthropic → runs in the agent Worker. With no
    // network the provider call fails, and the chat loop records that failure
    // as a streamTurn event *inside the Worker*.
    const input = page.locator('#ai-panel textarea');
    await input.fill('make a 10mm cube');
    await input.press('Enter');

    // Open the AI Call Log. The modal subscribes to the buffer, so it
    // live-updates as the forwarded event lands.
    await page.locator('#ai-panel button[title^="AI Call Log"]').dispatchEvent('click');
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Call Log' });
    await expect(modal).toBeVisible();

    // The streamTurn row is the proof the Worker-side event reached the main
    // thread's buffer. Before the fix this never appeared. Generous timeout:
    // the turn has to reach the provider transport and fail first.
    await expect(modal.getByText('streamTurn', { exact: false }).first()).toBeVisible({ timeout: 25_000 });
  });
});
