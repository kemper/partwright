import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Auto-continue mode: the agent only stops cleanly when the model calls the
// `finish` sentinel tool; a turn that ends WITHOUT finish is auto-resumed
// (bounded by the iteration + spend caps). These tests cover the tool gating,
// the system-prompt instruction, and the loop behavior end-to-end with a
// stubbed Gemini transport.

test.describe('Auto-continue (finish-tool resume)', () => {
  test('finish tool + prompt instruction appear only when auto-continue is ON', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const out = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const settings = await import('/src/ai/settings.ts');
      const sys = await import('/src/ai/systemPrompt.ts');
      const onToggles = settings.setToggles(settings.loadSettings(), { autoResume: true }).toggles;
      const offToggles = settings.setToggles(settings.loadSettings(), { autoResume: false }).toggles;
      return {
        onHasFinish: tools.buildToolList(onToggles).some(t => t.name === 'finish'),
        offHasFinish: tools.buildToolList(offToggles).some(t => t.name === 'finish'),
        onSuffix: sys.toggleSuffix(onToggles),
        offSuffix: sys.toggleSuffix(offToggles),
      };
    });
    expect(out.onHasFinish).toBe(true);
    expect(out.offHasFinish).toBe(false);
    expect(out.onSuffix).toMatch(/auto-continue is on/i);
    expect(out.onSuffix).toMatch(/finish/);
    expect(out.offSuffix).not.toMatch(/auto-continue is on/i);
  });

  test('a plain end_turn auto-resumes, then a finish call stops the loop cleanly', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini',
        geminiModel: 'gemini-flash-latest',
        autoResume: true,
        maxIterations: 'medium',
        vision: { views: false },
      }).toggles;

      let n = 0;
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        // Let the system-prompt (/ai.md) and any other fetch pass through;
        // only the Gemini stream is canned.
        if (!url.includes('generativelanguage.googleapis.com')) {
          return origFetch(input as RequestInfo, init);
        }
        n++;
        // Call 1: a plain text end_turn (model stopped WITHOUT calling finish)
        // → must auto-resume. Call 2: the model calls finish → loop stops.
        const frame = n === 1
          ? 'data: {"candidates":[{"content":{"parts":[{"text":"Working on it."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}'
          : 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"finish","args":{"summary":"all done"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };

      const ev = { autoResume: 0, toolResults: 0, reason: '' };
      try {
        const history = await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'autoresume-test', history: [], userBlocks: [{ type: 'text', text: 'do the thing' }] },
          {
            onAutoResume: () => { ev.autoResume++; },
            onToolResult: () => { ev.toolResults++; },
            onTurnComplete: info => { ev.reason = info.reason; },
          },
        );
        return {
          calls: n,
          autoResume: ev.autoResume,
          toolResults: ev.toolResults,
          reason: ev.reason,
          nudgeCount: history.filter(m => m.autoResumeNudge === true).length,
          calledFinish: history.some(m => (m.toolCalls ?? []).some(tc => tc.name === 'finish')),
        };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(out.calls).toBe(2);          // one extra request driven by the auto-resume
    expect(out.autoResume).toBe(1);     // exactly one synthetic continuation nudge
    expect(out.nudgeCount).toBe(1);     // and it's persisted in history
    expect(out.calledFinish).toBe(true);
    expect(out.toolResults).toBe(1);    // the finish tool produced a result
    expect(out.reason).toBe('end_turn'); // stopped cleanly, not iteration_cap
  });

  test('an EMPTY end_turn (empty_final) auto-resumes without breaking turn alternation', async ({ page }) => {
    // Regression: an empty assistant turn is dropped by the request builders, so
    // appending the user nudge after it would leave two consecutive user turns
    // (a hard 400 on Anthropic). The empty turn must get a placeholder so the
    // model/user/model/user alternation holds.
    await page.goto('/editor');
    await waitForEditorReady(page);
    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest', autoResume: true,
        maxIterations: 'medium', vision: { views: false },
      }).toggles;

      let n = 0;
      const bodies: string[] = [];
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes('generativelanguage.googleapis.com')) return origFetch(input as RequestInfo, init);
        n++;
        bodies.push(String(init?.body ?? ''));
        // Call 1: a truly empty end_turn (no parts). Call 2: finish.
        const frame = n === 1
          ? 'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":0}}'
          : 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"finish","args":{}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'autoresume-empty', history: [], userBlocks: [{ type: 'text', text: 'do it' }] },
          {},
        );
        // The SECOND request carries the resumed history — assert its roles
        // strictly alternate (no two consecutive 'user' contents).
        const contents = JSON.parse(bodies[1]).contents as Array<{ role: string; parts: Array<{ text?: string }> }>;
        let consecutiveUser = false;
        for (let i = 1; i < contents.length; i++) {
          if (contents[i].role === 'user' && contents[i - 1].role === 'user') consecutiveUser = true;
        }
        const nudge = contents[contents.length - 1];
        const nudgeText = (nudge.parts ?? []).map(p => p.text ?? '').join('');
        return { calls: n, roles: contents.map(c => c.role), consecutiveUser, nudgeText };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(out.calls).toBe(2);
    expect(out.consecutiveUser).toBe(false);
    // user("do it") → model("(no response)" placeholder) → user(nudge)
    expect(out.roles).toEqual(['user', 'model', 'user']);
    // The nudge must tell the model exactly what to call if it thinks it's done.
    expect(out.nudgeText).toMatch(/call the `?finish`? tool/i);
  });

  test('a model that never calls finish is bounded by the no-progress ceiling', async ({ page }) => {
    // Regression: without a no-progress ceiling, autoResume + a model that keeps
    // ending its turn without calling finish would loop until the iteration cap
    // (or forever under an infinite cap). The ceiling stops it well before the
    // high iteration cap (32) and lands on a normal end_turn outcome.
    await page.goto('/editor');
    await waitForEditorReady(page);
    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest', autoResume: true,
        maxIterations: 'high', vision: { views: false }, // cap 32 — must NOT be the limiter
      }).toggles;

      let n = 0;
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes('generativelanguage.googleapis.com')) return origFetch(input as RequestInfo, init);
        n++;
        // Always a plain text end_turn — the model never calls finish.
        const frame = 'data: {"candidates":[{"content":{"parts":[{"text":"still going"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const ev = { autoResume: 0, reason: '' };
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'autoresume-stuck', history: [], userBlocks: [{ type: 'text', text: 'do it' }] },
          { onAutoResume: () => { ev.autoResume++; }, onTurnComplete: info => { ev.reason = info.reason; } },
        );
        return { calls: n, autoResume: ev.autoResume, reason: ev.reason };
      } finally {
        window.fetch = origFetch;
      }
    });
    // 8 nudges, then the 9th request falls through to the normal outcome.
    expect(out.autoResume).toBe(8);
    expect(out.calls).toBe(9);
    expect(out.reason).toBe('end_turn'); // not iteration_cap (32) — the ceiling stopped it first
  });

  test('auto-continue is ON by default, and a disable persists across reload', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const pill = page.locator('#ai-panel button:has-text("Auto-continue")');
    await expect(pill).toBeVisible();
    // Enabled by default (fresh context → default standard preset).
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(async () => (await import('/src/ai/settings.ts')).loadSettings().toggles.autoResume)).toBe(true);

    // Disable it.
    await pill.dispatchEvent('click');
    await expect(pill).toHaveAttribute('aria-pressed', 'false');

    // The disable must survive a page refresh (the user's explicit ask).
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    const pillAfter = page.locator('#ai-panel button:has-text("Auto-continue")');
    await expect(pillAfter).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(async () => (await import('/src/ai/settings.ts')).loadSettings().toggles.autoResume)).toBe(false);
  });
});
