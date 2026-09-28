import { test, expect } from 'playwright/test';

// Regression coverage for persistent-storage durability of API keys.
// Best-effort IndexedDB is evicted under storage pressure (mobile browsers,
// iOS Safari ITP especially), wiping saved keys. We mitigate by requesting
// `navigator.storage.persist()` — once on its own merits, and again whenever a
// key is saved via `putKey`.
//
// The pure requestPersistentStorage() behavior (stubbed Storage API, no
// IndexedDB) moved to tests/unit/persist.test.ts — no browser needed there.
// The test below exercises `putKey`, which needs real IndexedDB, so it stays
// here.

test.describe('Persistent storage', () => {
  test('saving a key requests persistent storage', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const persistCalls = await page.evaluate(async () => {
      let calls = 0;
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: async () => false,
          persist: async () => { calls++; return true; },
        },
      });
      const db = await import('/src/ai/db.ts');
      await db.putKey({
        provider: 'anthropic',
        apiKey: 'sk-test',
        createdAt: Date.now(),
        lastUsed: Date.now(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      });
      // putKey fires the request fire-and-forget; give the microtask a beat.
      await new Promise((r) => setTimeout(r, 50));
      return calls;
    });
    expect(persistCalls).toBe(1);
  });
});
