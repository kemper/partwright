import { test, expect } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// Transient-error resilience: a provider HTTP 5xx / 429 / dropped stream used to
// tear the whole agent loop down — fatal even mid auto-continue. The chat loop
// now retries the same request with exponential backoff (bounded by
// ai.maxTransientRetries), WITHOUT consuming the agent's per-turn iteration
// budget. Fatal errors (auth/validation) still fail fast. These tests drive the
// real chatLoop on the main thread with a stubbed Gemini transport (the same
// trick ai-autoresume.spec.ts uses).

/** Shrink the backoff so retries don't add real wall-clock time to the suite. */
async function fastBackoff(page: import('playwright/test').Page, maxTransientRetries: number): Promise<void> {
  await page.evaluate(async (n) => {
    const cfg = await import('/src/config/appConfig.ts');
    const cur = cfg.getConfig();
    cfg.saveAppConfig({ ...cur, ai: { ...cur.ai, maxTransientRetries: n, transientRetryBaseMs: 1, transientRetryMaxMs: 2 } });
  }, maxTransientRetries);
}

test.describe('Transient provider-error retry', () => {
  test('a 5xx blip is retried, then the turn completes normally', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await fastBackoff(page, 4);

    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest',
        autoResume: false, maxIterations: 'medium', vision: { views: false },
      }).toggles;

      let n = 0;
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.href).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        n++;
        // Calls 1 & 2: HTTP 500 (transient). Call 3: a clean text end_turn.
        if (n <= 2) return new Response('{"error":{"message":"backend overloaded"}}', { status: 500 });
        const frame = 'data: {"candidates":[{"content":{"parts":[{"text":"Done."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };

      const ev = { errors: 0, reason: '' };
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'transient-5xx', history: [], userBlocks: [{ type: 'text', text: 'go' }] },
          { onError: () => { ev.errors++; }, onTurnComplete: info => { ev.reason = info.reason; } },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { calls: n, ...ev };
    });

    expect(out.calls).toBe(3);       // 2 failed attempts retried, then success
    expect(out.errors).toBe(0);      // the blip never surfaced as a hard error
    expect(out.reason).toBe('end_turn');
  });

  test('retries are bounded by maxTransientRetries, then surface a hard error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await fastBackoff(page, 2);

    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest',
        autoResume: false, maxIterations: 'medium', vision: { views: false },
      }).toggles;

      let n = 0;
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.href).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        n++;
        return new Response('{"error":{"message":"still down"}}', { status: 503 }); // always transient
      };

      const ev = { errors: 0, reason: '' };
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'transient-exhaust', history: [], userBlocks: [{ type: 'text', text: 'go' }] },
          { onError: () => { ev.errors++; }, onTurnComplete: info => { ev.reason = info.reason; } },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { calls: n, ...ev };
    });

    expect(out.calls).toBe(3);       // 1 initial + maxTransientRetries(2) retries
    expect(out.errors).toBe(1);      // then a single hard error
    expect(out.reason).toBe('error');
  });

  test('a fatal 4xx (auth) is NOT retried — it fails fast', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await fastBackoff(page, 4);

    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest',
        autoResume: false, maxIterations: 'medium', vision: { views: false },
      }).toggles;

      let n = 0;
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.href).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        n++;
        return new Response('{"error":{"message":"invalid api key"}}', { status: 401 });
      };

      const ev = { errors: 0, reason: '' };
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'fatal-4xx', history: [], userBlocks: [{ type: 'text', text: 'go' }] },
          { onError: () => { ev.errors++; }, onTurnComplete: info => { ev.reason = info.reason; } },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { calls: n, ...ev };
    });

    expect(out.calls).toBe(1);       // no retries on a fatal auth error
    expect(out.errors).toBe(1);
    expect(out.reason).toBe('error');
  });
});
