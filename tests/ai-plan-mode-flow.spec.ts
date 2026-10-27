import { test, expect } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// Plan mode end to end:
//  • the chat loop refuses a tool that wasn't offered this turn, so a planning
//    turn can't build even when the model calls a mutating tool it saw earlier;
//  • the plan bar asks for answers when the reply ends in questions, offers
//    "Build it" once there's a plan, and the approval carries the plan text to
//    a turn that has the full tool list.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const textReply = (id: string, text: string) => sse([
  ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const QUESTIONS = 'A few questions first:\n\n1. How tall should the vase be? (default 60 mm)\n2. Do you want a lid? (default no)\n\nLet me know and I will write the plan.';
const PLAN = '## Plan\n1. Revolve a 60 mm tall vase profile.\n2. Hollow it with 2 mm walls, no lid.\n\n## Assumptions\n- Units are mm.';

interface AnthropicBody {
  tools?: Array<{ name: string }>;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
}

function lastUserText(body: AnthropicBody): string {
  const last = body.messages[body.messages.length - 1];
  if (typeof last.content === 'string') return last.content;
  return last.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
}

test.describe('plan mode flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('a planning turn cannot run a tool it was not offered (pre-rename names still map)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForEditorReady(page);
    await waitForChatSessionId(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { getCode: () => string } }).partwright;
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest', autoResume: false, autoReview: false,
        maxIterations: 'medium', vision: { views: false }, planFirst: true,
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
      }).toggles;
      const codeBefore = pw.getCode();
      const origFetch = window.fetch;
      let n = 0;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.origin).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        n++;
        // First call: the model ignores plan mode and tries to write code, and
        // reads the objects under their pre-rename tool name (still allowed).
        const frame = n === 1
          ? 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"setCode","args":{"code":"return api.Manifold.sphere(5);"}}},{"functionCall":{"name":"listParts","args":{}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}'
          : 'data: {"candidates":[{"content":{"parts":[{"text":"Here is the plan."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const results: Array<{ name: string; content: string; isError: boolean }> = [];
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'plan-enforce', history: [], userBlocks: [{ type: 'text', text: 'make a sphere' }] },
          { onToolResult: (_id, name, r) => { results.push({ name, content: r.content, isError: r.isError }); } },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { results, codeUnchanged: pw.getCode() === codeBefore };
    });

    expect(out.results).toHaveLength(2);
    expect(out.results[0].name).toBe('setCode');
    expect(out.results[0].isError).toBe(true);
    expect(out.results[0].content).toContain('not available while planning');
    expect(out.codeUnchanged).toBe(true);
    // A pre-rename name counts as the read-only tool it stands for.
    expect(out.results[1].name).toBe('listParts');
    expect(out.results[1].isError).toBe(false);
  });

  test('questions, then a plan, then Build sends the plan with full tools', async ({ page }) => {
    test.setTimeout(150_000);
    const bodies: AnthropicBody[] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as AnthropicBody;
      bodies.push(body);
      const reply = bodies.length === 1 ? QUESTIONS : bodies.length === 2 ? PLAN : 'Built the vase.';
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: textReply(`m${bodies.length}`, reply) });
    });

    await page.goto('/editor');
    await waitForEditorReady(page);
    await waitForChatSessionId(page);
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('partwright');
        open.onsuccess = () => {
          const db = open.result;
          const txn = db.transaction('aiKeys', 'readwrite');
          txn.objectStore('aiKeys').put({ provider: 'anthropic', apiKey: 'test-key-placeholder', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
      const s = await import('/src/ai/settings.ts');
      s.saveSettings(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', thinking: 'off', autoReview: false, autoResume: false, planFirst: true }));
    });
    await page.reload();
    await waitForEditorReady(page);
    await waitForChatSessionId(page);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');

    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    const bar = panel.locator('[data-plan-state]');

    // 1. The model answers the plan request with questions.
    await input.fill('Make me a vase');
    await input.press('Enter');
    await expect(bar).toHaveAttribute('data-plan-state', 'questions', { timeout: 30_000 });
    await expect(bar).toContainText('The AI has questions');
    await expect(bar.getByRole('button', { name: 'Build anyway' })).toBeVisible();
    await expect(bar.getByRole('button', { name: /Discard plan/ })).toBeVisible();
    // The user bubble shows their words under a chip, not the app's instructions.
    await expect(panel.locator('[data-plan-chip]').first()).toHaveText('📋 Plan first');
    await expect(panel.getByText('Before doing anything, write a concise plan', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/plan-mode-questions.png' });

    // 2. The user answers; the model writes the plan.
    await input.fill('60 mm, no lid');
    await input.press('Enter');
    await expect(bar).toHaveAttribute('data-plan-state', 'plan', { timeout: 30_000 });
    await expect(bar.getByRole('button', { name: /Build it/ })).toBeVisible();
    await expect(panel.locator('[data-plan-chip]').nth(1)).toHaveText('📋 Plan revision');
    await page.screenshot({ path: 'test-results/plan-mode-plan-ready.png' });

    // Both planning turns offered only the read-only tools.
    for (const b of bodies.slice(0, 2)) {
      const names = (b.tools ?? []).map(t => t.name);
      expect(names).toContain('getCode');
      expect(names).not.toContain('setCode');
      expect(names).not.toContain('runAndSave');
    }

    // 3. Build: the approval carries the plan and the turn has the full tools.
    await bar.getByRole('button', { name: /Build it/ }).click();
    await expect(panel.getByText('Built the vase.')).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-plan-approved]')).toHaveText('✓ Plan approved — building');
    await expect(bar).toBeHidden();
    const buildBody = bodies[2];
    expect(lastUserText(buildBody)).toContain('[Plan approved');
    expect(lastUserText(buildBody)).toContain('Revolve a 60 mm tall vase profile');
    expect((buildBody.tools ?? []).map(t => t.name)).toContain('runAndSave');
    await page.screenshot({ path: 'test-results/plan-mode-approved.png' });
  });
});
