// End-to-end dispatch of the chat tools added in #1085 PR5 — healCurrent,
// renderSection, paintAirbrush, setRegionVisibility, replaceColor, editPalette,
// the reference ghost, saveAllObjects, listCatalog, exportModel and
// importImageAsVoxels — driven through the real executeTool path against a
// live session, so each wrapper is proven against the real console API
// signature. Also covers the pre-confirm refusal (a call that would be refused
// anyway never prompts the user) and the exportModel confirm prompt wording.
// The pure gating/dispatch logic is covered in tests/unit/aiToolGating.test.ts.

import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

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
const toolReply = (id: string, name: string, input: unknown) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ...end('tool_use'),
]);

test.describe('AI remaining tools (#1085 PR5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('new wrappers dispatch end to end against the live API', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const call = async (name: string, input: Record<string, unknown> = {}) => {
        const r = await tools.executeTool(name, input);
        return { isError: r.isError, hasImage: !!r.image, data: (() => { try { return JSON.parse(r.content); } catch { return r.content; } })() };
      };

      await pw.createSession('ai-remaining-tools');
      pw.clearColors();
      await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);', 'cube');

      const heal = await call('healCurrent');
      const section = await call('renderSection', { axis: 'x' });
      const sectionMiss = await call('renderSection', { axis: 'z', offset: 500 });

      const spray = await call('paintAirbrush', { points: [[0, 0, 5]], radius: 3, strength: 1, color: [1, 0, 0], name: 'spray' });
      const regions = pw.listRegions() as Array<{ id: number; name: string }>;
      const sprayId = regions.find(r => r.name === 'spray')?.id;
      const hide = await call('setRegionVisibility', { id: sprayId, visible: false });
      const replace = await call('replaceColor', { from: [1, 0, 0], to: [0, 0, 1] });

      const added = await call('editPalette', { op: 'addFilament', name: 'PR5 Test Teal', hex: '#1fa89a' });
      const newSlot = added.data?.result?.id as string | undefined;
      const removed = await call('editPalette', { op: 'removeFilament', id: newSlot });

      const ghost = await call('setReferenceGeometry', { code: 'return api.Manifold.cube([2, 2, 30], true);', color: '#00ff80', opacity: 0.4 });
      const ghostShown = pw.hasReferenceGeometry();
      const ghostCleared = await call('clearReferenceGeometry');
      const ghostAfter = pw.hasReferenceGeometry();

      const saveAll = await call('saveAllObjects');
      const catalog = await call('listCatalog', { query: 'companion', limit: 5 });
      const exportStl = await call('exportModel', { format: 'stl', filename: 'pr5-cube' });
      const exportStep = await call('exportModel', { format: 'step' });

      // A tiny red PNG as a data URL → voxel art in a NEW session (last: it
      // switches the session).
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 4, 4);
      const voxels = await call('importImageAsVoxels', { src: c.toDataURL('image/png'), maxSize: 4 });
      const badScheme = await call('importImageAsVoxels', { src: 'file:///tmp/a.png' });

      return { heal, section, sectionMiss, spray, hide, replace, added, removed, ghost, ghostShown, ghostCleared, ghostAfter, saveAll, catalog, exportStl, exportStep, voxels, badScheme, sprayId };
    });

    expect(out.heal.isError).toBe(false);
    expect(out.heal.data).toMatchObject({ ok: true, componentCountAfter: 1 });

    expect(out.section.isError).toBe(false);
    expect(out.section.hasImage).toBe(true);
    // A cut that misses the model is an empty section, not an error.
    expect(out.sectionMiss.isError).toBe(false);
    expect(String(out.sectionMiss.data)).toContain('contours=0 (empty)');

    expect(out.spray.isError).toBe(false);
    expect(out.spray.data.error).toBeUndefined();
    expect(typeof out.sprayId).toBe('number');
    expect(out.hide.data).toEqual({ id: out.sprayId, visible: false });
    expect(out.replace.data.replaced).toBeGreaterThanOrEqual(1);

    expect(out.added.data.result).toMatchObject({ name: 'PR5 Test Teal', hex: '#1fa89a' });
    expect(out.added.data.palette.slots.some((s: { name: string }) => s.name === 'PR5 Test Teal')).toBe(true);
    expect(out.removed.data.palette.slots.some((s: { name: string }) => s.name === 'PR5 Test Teal')).toBe(false);

    expect(out.ghost.data.success).toBe(true);
    expect(out.ghostShown).toBe(true);
    expect(out.ghostCleared.data).toEqual({ cleared: true });
    expect(out.ghostAfter).toBe(false);

    expect(out.saveAll.data).toMatchObject({ saved: expect.any(Number) });
    expect(out.catalog.data.entries.some((e: { id: string }) => e.id === 'companion-cube')).toBe(true);
    expect(out.catalog.data.total).toBeGreaterThan(out.catalog.data.count);

    expect(out.exportStl.data).toMatchObject({ ok: true, format: 'stl' });
    expect(out.exportStep.data.error).toMatch(/BREP/);

    expect(out.voxels.data.voxelCount).toBeGreaterThan(0);
    expect(typeof out.voxels.data.sessionId).toBe('string');
    expect(out.badScheme.data.error).toMatch(/http\(s\) URL or a data:image/);
  });

  test('a call that would be refused anyway never prompts the user', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const chatLoop = await import('/src/ai/chatLoop.ts');
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
        const frame = n === 1
          ? 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"importFromUrl","args":{"url":"https://example.com/remote.partwright.json"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}'
          : 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}';
        return new Response(new Blob([frame + '\r\n\r\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const prompts: string[] = [];
      const results: string[] = [];
      try {
        await chatLoop.runTurn(
          { apiKey: 'k', toggles, sessionId: 'pre-confirm', history: [], userBlocks: [{ type: 'text', text: 'import that' }] },
          {
            confirmTool: async (name: string) => { prompts.push(name); return true; },
            onToolResult: (_id: string, name: string, r: { content: string }) => { if (name === 'importFromUrl') results.push(r.content); },
          },
        );
      } finally {
        window.fetch = origFetch;
      }
      return { prompts, results };
    });
    expect(out.prompts).toEqual([]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toContain('contains model code');
  });

  test('exportModel prompt names the format and the object; Escape declines', async ({ page }) => {
    test.setTimeout(150_000);
    let chatCalls = 0;
    await page.route('https://api.anthropic.com/**', async route => {
      chatCalls++;
      const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: unknown }> };
      const last = body.messages[body.messages.length - 1];
      const lastIsToolResult = Array.isArray(last.content) && (last.content as Array<{ type: string }>).some(b => b.type === 'tool_result');
      const reply = lastIsToolResult ? textReply(`end${chatCalls}`, `Done ${chatCalls}.`) : toolReply(`t${chatCalls}`, 'exportModel', { format: '3mf' });
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
          txn.objectStore('aiKeys').put({ provider: 'anthropic', apiKey: 'test-key-placeholder', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
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
    await waitForChatSessionId(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
      await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);', 'cube');
    });
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');

    let downloads = 0;
    page.on('download', () => { downloads++; });
    const input = page.locator('#ai-panel textarea');
    await input.fill('Export this as a 3MF');
    await input.press('Enter');

    const message = page.getByTestId('ai-tool-confirm-message');
    await expect(message).toBeVisible({ timeout: 30_000 });
    await expect(message).toHaveText('The AI wants to download a 3MF file of object "Object 1". Allow this?');
    await page.screenshot({ path: 'test-results/ai-export-model-confirm.png' });

    await page.keyboard.press('Escape');
    await expect(message).toBeHidden();
    await expect(page.locator('#ai-panel').getByText(/^Done \d+\.$/)).toHaveCount(1, { timeout: 30_000 });
    expect(downloads).toBe(0);
  });
});
