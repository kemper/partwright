import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Offline-mode coverage. The app is designed to keep working without a
// network: work persists in IndexedDB, modeling runs in WASM, and the local
// WebLLM model needs no per-turn network. These tests exercise the
// connectivity-aware UI (the global offline pill + the AI panel's "switch to a
// local model" notice). They use Playwright's `context.setOffline`, which
// flips `navigator.onLine` and fires the `offline`/`online` events
// deterministically — no real network required (the rest of the suite runs
// online, so the indicators stay hidden there).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Offline mode', () => {
  test('global offline pill toggles with connectivity', async ({ page, context }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    const pill = page.locator('#offline-indicator');
    // Online by default — the pill exists in the DOM but stays hidden.
    await expect(pill).toBeHidden();

    await context.setOffline(true);
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(/offline/i);

    await context.setOffline(false);
    await expect(pill).toBeHidden();
  });

  test('AI panel steers cloud users to a local model when offline', async ({ page, context }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);

    const notice = page.locator('#offline-notice');

    // A fresh, unconfigured session defaults to a hosted provider (Anthropic),
    // so going offline should surface the "can't respond / switch to local"
    // notice.
    await context.setOffline(true);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/switch to a local model/i);

    // Back online — the notice goes away.
    await context.setOffline(false);
    await expect(notice).toBeHidden();
  });
});
