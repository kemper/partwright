import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// delegateTask: the main agent (Opus) hands a measurable sub-task to a cheaper
// worker (Sonnet) that runs its own loop on the same session. The worker's
// steps stay out of the main chat; only its report comes back as the tool
// result, and its spend counts toward the turn.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const start = (id: string, model: string) => ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } }] as [string, unknown];
const toolReply = (id: string, model: string, name: string, input: unknown) => sse([
  start(id, model),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 200 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const textReply = (id: string, model: string, text: string) => sse([
  start(id, model),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 80 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const MAIN = 'claude-opus-5-5';
const WORKER = 'claude-sonnet-5-5';
const TASK = 'Tune the cube so its edge length is exactly 12.';
const REPORT = 'Done. Edge length is 12.0; isManifold true; saved as cube-12.';

interface Body {
  model: string;
  tools?: Array<{ name: string }>;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; content?: unknown }> }>;
}
const textOf = (b: Body) => JSON.stringify(b.messages);

async function setUp(page: Page): Promise<void> {
  await page.goto('/editor');
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await page.evaluate(async (model) => {
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
    s.saveSettings(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: model, thinking: 'medium', maxSpend: 'high', autoReview: false, autoResume: false, planFirst: false }));
  }, MAIN);
  await page.reload();
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await openAiPanel(page);
  const heading = page.getByRole('heading', { name: 'AI Settings' });
  if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

test.describe('AI worker delegation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('main agent delegates to a cheaper worker and gets only its report back', async ({ page }) => {
    test.setTimeout(150_000);
    const bodies: Body[] = [];
    let releaseWorker: () => void = () => {};
    const workerGate = new Promise<void>(r => { releaseWorker = r; });
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as Body;
      bodies.push(body);
      const n = bodies.length;
      let reply: string;
      if (n === 1) reply = toolReply('m1', MAIN, 'delegateTask', { task: TASK, acceptance: 'edge length 12, isManifold', maxSteps: 4 });
      else if (n === 2) reply = toolReply('w1', WORKER, 'getGeometryData', {});
      else if (n === 3) { await workerGate; reply = textReply('w2', WORKER, REPORT); }
      else reply = textReply('m2', MAIN, 'The worker tuned the cube to 12 and saved it.');
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });

    await setUp(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    await input.fill('Make the cube exactly 12 units');
    await input.press('Enter');

    // While the worker runs, the progress line names it and its step.
    await expect(panel.getByText(`worker · ${WORKER} · step`, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: 'test-results/delegate-worker-running.png' });
    releaseWorker();

    await expect(panel.getByText('The worker tuned the cube to 12 and saved it.')).toBeVisible({ timeout: 30_000 });
    expect(bodies.map(b => b.model)).toEqual([MAIN, WORKER, WORKER, MAIN]);

    // The main agent is offered delegateTask; the worker never is, nor askUser.
    expect(bodies[0].tools?.some(t => t.name === 'delegateTask')).toBe(true);
    const workerTools = (bodies[1].tools ?? []).map(t => t.name);
    expect(workerTools).not.toContain('delegateTask');
    expect(workerTools).not.toContain('askUser');

    // The worker starts from an empty history: only the brief.
    expect(bodies[1].messages).toHaveLength(1);
    expect(textOf(bodies[1])).toContain(`TASK:\\n${TASK}`);
    expect(textOf(bodies[1])).not.toContain('Make the cube exactly 12 units');

    // The main agent's next request carries the report, not the worker's steps.
    const back = textOf(bodies[3]);
    expect(back).toContain(`[Worker ${WORKER} finished · 2 steps · 1 tool call`);
    expect(back).toContain(REPORT);
    expect(back).not.toContain('getGeometryData');
    await page.screenshot({ path: 'test-results/delegate-worker-done.png' });

    // The worker's steps were never saved into the chat.
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await expect(panel.getByText('The worker tuned the cube to 12 and saved it.')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('You are a worker agent', { exact: false })).toHaveCount(0);
  });
});
