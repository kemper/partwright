import { test, expect } from 'playwright/test';

// Regression coverage for persistent-storage durability of API keys.
// Best-effort IndexedDB is evicted under storage pressure (mobile browsers,
// iOS Safari ITP especially), wiping saved keys. We mitigate by requesting
// `navigator.storage.persist()` — once on its own merits, and again whenever a
// key is saved via `putKey`. These tests stub the Storage API so they run with
// no network and no real grant (headless Chromium denies persistence).
//
// Each test relies on its own fresh BrowserContext/page so the module-level
// `granted`/`inFlight` singletons in persist.ts reset between tests — keep them
// in separate tests; don't consolidate into one page or the cached grant leaks.

test.describe('Persistent storage', () => {
  test('requestPersistentStorage calls persist() and is idempotent once granted', async ({ page }) => {
    await page.goto('/editor');
    const result = await page.evaluate(async () => {
      let persistCalls = 0;
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: async () => false,
          persist: async () => { persistCalls++; return true; },
        },
      });
      const mod = await import('/src/storage/persist.ts');
      const first = await mod.requestPersistentStorage();
      // Second call should short-circuit on the cached grant, not re-request.
      const second = await mod.requestPersistentStorage();
      return { first, second, persistCalls };
    });
    expect(result.first).toBe(true);
    expect(result.second).toBe(true);
    expect(result.persistCalls).toBe(1);
  });

  test('an already-persisted origin never re-requests', async ({ page }) => {
    await page.goto('/editor');
    const result = await page.evaluate(async () => {
      let persistCalls = 0;
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: async () => true,
          persist: async () => { persistCalls++; return true; },
        },
      });
      const mod = await import('/src/storage/persist.ts');
      const granted = await mod.requestPersistentStorage();
      return { granted, persistCalls };
    });
    expect(result.granted).toBe(true);
    expect(result.persistCalls).toBe(0);
  });

  test('a denied request is not cached — a later call can still succeed', async ({ page }) => {
    await page.goto('/editor');
    const result = await page.evaluate(async () => {
      let allow = false;
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: async () => false,
          persist: async () => allow,
        },
      });
      const mod = await import('/src/storage/persist.ts');
      const denied = await mod.requestPersistentStorage();
      allow = true; // engagement improved (e.g. user saved a key)
      const granted = await mod.requestPersistentStorage();
      return { denied, granted };
    });
    expect(result.denied).toBe(false);
    expect(result.granted).toBe(true);
  });

  test('soft-fails when the Storage API is unavailable', async ({ page }) => {
    await page.goto('/editor');
    const result = await page.evaluate(async () => {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
      const mod = await import('/src/storage/persist.ts');
      return mod.requestPersistentStorage();
    });
    expect(result).toBe(false);
  });

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
