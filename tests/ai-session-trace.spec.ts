import { test, expect } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// The AI session trace: a real (mocked-provider) turn runs in the agent
// Worker, the chat loop persists per-call telemetry + tool timings on the chat
// messages, and the 🩺 modal's "Download session trace" writes it all out as
// one JSON file — from the saved chat, so it survives a reload (the AI Call
// Log itself is in-memory and starts empty after one).

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const TOOL_CALL = sse({
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'getCode', args: {} } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 20_000, candidatesTokenCount: 40, totalTokenCount: 20_040 },
});
const FINAL = sse({
  candidates: [{ content: { role: 'model', parts: [{ text: 'The code returns a cube.' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 20_500, cachedContentTokenCount: 18_000, candidatesTokenCount: 12, totalTokenCount: 20_512 },
});

test('AI session trace: telemetry is persisted and downloadable after a reload', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  let requests = 0;
  await page.route('**/v1beta/models/**', async (route) => {
    requests++;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: requests === 1 ? TOOL_CALL : FINAL });
  });

  await page.goto('/editor');
  await waitForEditorReady(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('partwright');
      open.onsuccess = () => {
        const db = open.result;
        const txn = db.transaction('aiKeys', 'readwrite');
        txn.objectStore('aiKeys').put({ provider: 'gemini', apiKey: 'AIza-test-0000', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
        txn.oncomplete = () => { db.close(); resolve(); };
        txn.onerror = () => reject(txn.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await waitForEditorReady(page);
  await page.evaluate(async () => {
    const s = await import('/src/ai/settings.ts');
    s.saveSettings(s.setGeminiModel(s.setProvider(s.loadSettings(), 'gemini'), 'gemini-flash-latest'));
  });
  await openAiPanel(page);
  const settings = page.getByRole('heading', { name: 'AI Settings' });
  if (await settings.isVisible().catch(() => false)) await page.keyboard.press('Escape');

  const input = page.locator('#ai-panel textarea');
  await input.fill('what does the code do?');
  await input.press('Enter');
  await expect(page.locator('#ai-panel')).toContainText('The code returns a cube.', { timeout: 30_000 });
  expect(requests).toBe(2);

  // Reload: the in-memory call log is gone, the trace still has everything.
  await page.reload();
  await waitForEditorReady(page);
  await openAiPanel(page);
  if (await settings.isVisible().catch(() => false)) await page.keyboard.press('Escape');

  await page.locator('#ai-panel button[title^="AI Call Log"]').dispatchEvent('click');
  const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Call Log' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('No AI calls have been made in this tab since the page loaded.');

  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download session trace' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/ai-trace.*\.json$/);
  await expect(modal.getByTestId('ai-trace-status')).toContainText('2 API call(s), 1 tool call(s)');
  await page.screenshot({ path: 'test-results/ai-session-trace-modal.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/ai-session-trace-modal-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 720 });

  const trace = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(trace.format).toBe('partwright-ai-session-trace');
  expect(trace.summary).toMatchObject({ humanPrompts: 1, apiCalls: 2, toolCalls: 1, toolErrors: 0 });
  expect(trace.summary.tokens.cacheReadTokens).toBe(18_000);
  expect(trace.summary.byModel['gemini/gemini-flash-latest'].calls).toBe(2);
  expect(trace.summary.byTool.getCode.calls).toBe(1);
  expect(trace.turns).toHaveLength(1);
  expect(trace.turns[0].steps).toEqual(['getCode', '(reply)']);

  const calls = trace.timeline.filter((e: { kind: string }) => e.kind === 'assistant');
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ provider: 'gemini', model: 'gemini-flash-latest', iteration: 0, toolCalls: [{ name: 'getCode' }] });
  expect(calls[0].request.tools).toContain('getCode');
  expect(calls[0].request.toolSchemaChars).toBeGreaterThan(1000);
  expect(calls[0].request.systemPromptChars).toBeGreaterThan(1000);
  expect(calls[1]).toMatchObject({ iteration: 1, text: 'The code returns a cube.' });
  const results = trace.timeline.find((e: { kind: string }) => e.kind === 'tool_results');
  expect(results.toolResults[0]).toMatchObject({ tool: 'getCode', isError: false });
  expect(typeof results.toolResults[0].durationMs).toBe('number');
  expect(JSON.stringify(trace)).not.toContain('AIza-test-0000');

  // The console API returns the same trace.
  const viaApi = await page.evaluate(async () => {
    const t = await (window as unknown as { partwright: { getAiSessionTrace: () => Promise<{ summary: { apiCalls: number } }> } }).partwright.getAiSessionTrace();
    return t.summary.apiCalls;
  });
  expect(viaApi).toBe(2);
});
