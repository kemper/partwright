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

  test('the Auto-continue pill toggles the setting', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await page.evaluate(async () => {
      const settings = await import('/src/ai/settings.ts');
      settings.saveSettings(settings.setToggles(settings.loadSettings(), { autoResume: false }));
    });
    await openAiPanel(page);
    const pill = page.locator('#ai-panel button:has-text("Auto-continue")');
    await expect(pill).toBeVisible();
    expect(await pill.getAttribute('aria-pressed')).toBe('false');
    await pill.dispatchEvent('click');
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    const persisted = await page.evaluate(async () => {
      const settings = await import('/src/ai/settings.ts');
      return settings.loadSettings().toggles.autoResume;
    });
    expect(persisted).toBe(true);
  });
});
