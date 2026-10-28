import { test, expect } from 'playwright/test';
import { waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// On-demand tool groups (#1175) through the real chat loop: the first request
// sends only the core tools + loadTools, a loadTools call widens the NEXT
// request, and a grouped tool called without loading still runs and loads its
// group. Driven in-page against a stubbed Gemini endpoint, like the plan-mode
// enforcement test.

test.describe('AI tool groups', () => {
  test('core first, loadTools widens the next request, an unloaded tool still runs', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForEditorReady(page);
    await waitForChatSessionId(page);

    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest', autoResume: false, autoReview: false,
        maxIterations: 'medium', vision: { views: false }, planFirst: false,
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: false },
      }).toggles;
      const frames = [
        '{"functionCall":{"name":"loadTools","args":{"groups":["transforms"]}}}',
        '{"functionCall":{"name":"getUnits","args":{}}}',
        '{"text":"Done."}',
      ];
      const requests: Array<{ tools: string[]; system: string }> = [];
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.origin).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        const body = JSON.parse(String(init?.body)) as { tools?: Array<{ functionDeclarations: Array<{ name: string }> }>; systemInstruction: { parts: Array<{ text: string }> } };
        requests.push({
          tools: (body.tools?.[0]?.functionDeclarations ?? []).map(d => d.name),
          system: body.systemInstruction.parts.map(p => p.text).join('\n'),
        });
        const part = frames[Math.min(requests.length - 1, frames.length - 1)];
        const frame = `data: {"candidates":[{"content":{"parts":[${part}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}`;
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const results: Array<{ name: string; content: string; isError: boolean }> = [];
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'tool-groups', history: [], userBlocks: [{ type: 'text', text: 'scale it up' }] },
          { onToolResult: (_id, name, r) => { results.push({ name, content: r.content, isError: r.isError }); } },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { requests, results };
    });

    expect(out.requests).toHaveLength(3);
    const [first, second, third] = out.requests;
    // Turn 0: core + loadTools, nothing grouped.
    expect(first.tools).toContain('runAndSave');
    expect(first.tools).toContain('loadTools');
    expect(first.tools).not.toContain('scaleModel');
    expect(first.tools).not.toContain('getUnits');
    expect(first.tools.length).toBeLessThan(70);
    expect(first.system).toContain('Not loaded yet');
    // loadTools answered locally and widened the next request.
    expect(out.results[0].name).toBe('loadTools');
    expect(out.results[0].isError).toBe(false);
    expect(JSON.parse(out.results[0].content).loaded.transforms).toContain('scaleModel');
    expect(second.tools).toContain('scaleModel');
    expect(second.tools.slice(0, first.tools.length)).toEqual(first.tools);
    // A grouped tool called without loading still runs, and loads its group.
    expect(out.results[1].name).toBe('getUnits');
    expect(out.results[1].isError).toBe(false);
    expect(third.tools).toContain('setUnits');
  });
});
