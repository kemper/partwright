import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// Confirmation for confirm-required AI tools (CONFIRM_REQUIRED_TOOLS —
// imports and deleteVersion). Covers:
//  • the real panel prompt (agent Worker path): it names the version, its label
//    and the object; Escape declines (nothing deleted), Allow deletes;
//  • the main-thread chat loop: no prompt available → fails CLOSED, and an
//    Allow that races a Stop does not run the tool.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const start = (id: string) => ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 1 } } }] as [string, unknown];
const end = (reason: string) => [
  ['message_delta', { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 20 } }],
  ['message_stop', { type: 'message_stop' }],
] as Array<[string, unknown]>;
const textReply = (id: string, text: string) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ...end('end_turn'),
]);
const deleteReply = (id: string) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name: 'deleteVersion', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ index: 2 }) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ...end('tool_use'),
]);

async function seedSession(page: Page): Promise<void> {
  await waitForChatSessionId(page);
  await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
    await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);', 'draft');
    await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([20, 10, 10], true);', 'final');
  });
}

async function versionCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const pw = (window as unknown as { partwright: { listVersions: () => Promise<unknown[]> } }).partwright;
    return (await pw.listVersions()).length;
  });
}

test.describe('AI tool confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('deleteVersion prompt names the version and object; Escape declines, Allow deletes', async ({ page }) => {
    test.setTimeout(150_000);
    let chatCalls = 0;
    await page.route('https://api.anthropic.com/**', async route => {
      chatCalls++;
      const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: unknown }> };
      const last = body.messages[body.messages.length - 1];
      const lastIsToolResult = Array.isArray(last.content) && (last.content as Array<{ type: string }>).some(b => b.type === 'tool_result');
      const reply = lastIsToolResult ? textReply(`end${chatCalls}`, `Done ${chatCalls}.`) : deleteReply(`t${chatCalls}`);
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
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
          txn.objectStore('aiKeys').put({ provider: 'anthropic', apiKey: 'sk-ant-test', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
      const s = await import('/src/ai/settings.ts');
      s.saveSettings(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', thinking: 'off', autoReview: false, autoResume: false }));
    });
    await page.reload();
    await waitForEditorReady(page);
    await seedSession(page);
    expect(await versionCount(page)).toBe(2);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');

    const input = page.locator('#ai-panel textarea');
    await input.fill('Delete version 2');
    await input.press('Enter');

    const message = page.getByTestId('ai-tool-confirm-message');
    await expect(message).toBeVisible({ timeout: 30_000 });
    await expect(message).toHaveText("The AI wants to permanently delete version 2 'final' of object Object 1. Allow this?");
    // Focus starts on Decline (the safe default for an irreversible action).
    await expect(page.getByRole('button', { name: 'Decline' })).toBeFocused();
    await page.screenshot({ path: 'test-results/ai-tool-confirm-delete-version.png' });

    // Escape declines: the version survives.
    await page.keyboard.press('Escape');
    await expect(message).toBeHidden();
    await expect(page.locator('#ai-panel').getByText(/^Done \d+\.$/)).toHaveCount(1, { timeout: 30_000 });
    expect(await versionCount(page)).toBe(2);

    // Ask again and Allow: the version is deleted.
    await input.fill('Delete version 2 for real');
    await input.press('Enter');
    await expect(message).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect(page.locator('#ai-panel').getByText(/^Done \d+\.$/)).toHaveCount(2, { timeout: 30_000 });
    expect(await versionCount(page)).toBe(1);
  });

  test('main-thread loop: no prompt fails closed, and Allow after Stop does not run the tool', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForEditorReady(page);
    await seedSession(page);

    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const tools = await import('/src/ai/tools.ts');
      const settings = await import('/src/ai/settings.ts');
      const toggles = settings.setToggles(settings.loadSettings(), {
        provider: 'gemini', geminiModel: 'gemini-flash-latest', autoResume: false, autoReview: false,
        maxIterations: 'medium', vision: { views: false },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
      }).toggles;
      const origFetch = window.fetch;
      let n = 0;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: RequestInit) => {
        if (new URL(String(input), location.origin).hostname !== 'generativelanguage.googleapis.com') return origFetch(input as RequestInfo, init);
        n++;
        // Odd calls: the model asks to delete version 2. Even calls: it stops.
        const frame = n % 2 === 1
          ? 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"deleteVersion","args":{"index":2}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}'
          : 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const pw = (window as unknown as { partwright: { listVersions: () => Promise<unknown[]> } }).partwright;
      const results: string[] = [];
      try {
        // 1. No confirmTool callback and the real executeTool → fail closed.
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'confirm-closed', history: [], userBlocks: [{ type: 'text', text: 'delete v2' }] },
          { onToolResult: (_id, name, r) => { if (name === 'deleteVersion') results.push(r.content); } },
        );
        const afterClosed = (await pw.listVersions()).length;
        // 2. The user hits Stop while the prompt is up, then the Allow lands.
        const controller = new AbortController();
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'confirm-abort', history: [], userBlocks: [{ type: 'text', text: 'delete v2' }], signal: controller.signal },
          {
            confirmTool: async () => { controller.abort(); return true; },
            onToolResult: (_id, name, r) => { if (name === 'deleteVersion') results.push(r.content); },
          },
        );
        const afterAbort = (await pw.listVersions()).length;
        return { results, afterClosed, afterAbort, unavailable: tools.CONFIRM_UNAVAILABLE_MESSAGE };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(out.results[0]).toBe(out.unavailable);
    expect(out.afterClosed).toBe(2);
    expect(out.results[1]).toBe('[aborted by user]');
    expect(out.afterAbort).toBe(2);
  });
});
