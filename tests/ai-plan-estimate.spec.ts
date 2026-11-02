import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// Plan mode feasibility (#1209):
//  • a new plan request asks how to plan (Quick / Assess first / Compare);
//  • the plan card shows the estimate (difficulty, rounds, cost, confidence);
//  • Build runs under the plan's round budget — it stops at a checkpoint at the
//    estimated max (not the ⟲ cap), Keep going grants another batch, and the
//    finished build is recorded for calibration.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const start = (id: string) => ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 1 } } }] as [string, unknown];
const textReply = (id: string, text: string) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
  ['message_stop', { type: 'message_stop' }],
]);
const toolReply = (id: string, name: string, input: unknown) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const PLAN_INPUT = {
  summary: 'Feasible: a stylised dog bust from the photo using the creature kit — recognisable, not photo-exact.',
  steps: ['Block out head and muzzle with the creature kit.', 'Add ears and eyes, compare against the photo.', 'Check printability.'],
  assumptions: ['Bust only, 60 mm tall.'],
  estimate: {
    difficulty: 'hard', confidence: 60, roundsMin: 2, roundsMax: 3,
    quality: 'recognisable, stylised', gaps: ['No fur geometry — fur is a surface texture only'], risks: ['Likeness may need several passes'],
  },
};

interface AnthropicBody {
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
}

function userText(body: AnthropicBody): string {
  return body.messages.filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n'))).join('\n');
}

async function setUp(page: Page): Promise<void> {
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
    // The ⟲ cap is Ultra (64): the build must stop at the plan's 3 rounds anyway.
    s.saveSettings(s.setToggles(s.loadSettings(), {
      provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', thinking: 'off', autoReview: false, autoResume: false,
      planFirst: true, maxIterations: 'ultra', maxSpend: 'infinity',
    }));
    localStorage.removeItem('partwright.planCalibration');
  });
  await page.reload();
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await openAiPanel(page);
  const heading = page.getByRole('heading', { name: 'AI Settings' });
  if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

test.describe('plan mode estimates and checkpoints', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('style picker → assess plan with estimate → build pauses at the estimate', async ({ page }) => {
    test.setTimeout(180_000);
    const bodies: AnthropicBody[] = [];
    let buildCalls = 0;
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as AnthropicBody;
      bodies.push(body);
      const n = bodies.length;
      let reply: string;
      if (n === 1) reply = toolReply('plan', 'proposePlan', PLAN_INPUT);
      else {
        // Build: keep calling a tool; finish on the 5th build request (after
        // the checkpoint's Keep going).
        buildCalls++;
        reply = buildCalls < 5 ? toolReply(`b${buildCalls}`, 'getCode', {}) : textReply(`b${buildCalls}`, 'Bust done.');
      }
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });
    await setUp(page);

    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');

    // 1. A new plan request asks how to plan; nothing is sent yet.
    await input.fill('Make a bust of my dog from the photo');
    await input.press('Enter');
    const picker = panel.locator('[data-plan-style-picker]');
    await expect(picker).toBeVisible();
    await expect(picker.locator('[data-plan-style]')).toHaveCount(3);
    expect(bodies).toHaveLength(0);
    await page.screenshot({ path: 'test-results/plan-style-picker.png' });

    // 2. Assess first: the request carries the assessment instructions.
    await picker.locator('[data-plan-style="assess"]').click();
    await expect(picker).toBeHidden();
    const planCard = panel.locator('[data-plan-card]');
    await expect(planCard).toBeVisible({ timeout: 30_000 });
    expect(userText(bodies[0])).toContain('ASSESS this request');
    expect(userText(bodies[0])).toContain('Make a bust of my dog');
    await expect(panel.locator('[data-plan-chip]').first()).toHaveText('🔎 Assess first');

    // 3. The card shows the estimate.
    const estimate = planCard.locator('[data-plan-estimate="hard"]');
    await expect(estimate).toContainText('Hard');
    await expect(estimate).toContainText('~2–3 rounds');
    await expect(estimate).toContainText('60% confident');
    await expect(estimate).toContainText('≈ $');
    await expect(estimate).toContainText('No fur geometry');
    await expect(estimate).toContainText('pauses for your go-ahead after 3 rounds');
    await planCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/plan-estimate-card.png' });

    // 4. Build stops at the plan's 3 rounds, not the ⟲ cap of 64.
    await panel.locator('[data-plan-state]').getByRole('button', { name: /Build it/ }).click();
    const checkpoint = panel.locator('[data-plan-checkpoint]');
    await expect(checkpoint).toBeVisible({ timeout: 60_000 });
    expect(buildCalls).toBe(3);
    await expect(checkpoint).toContainText('3 rounds used (estimated 2–3 rounds)');
    const keepGoing = checkpoint.getByRole('button', { name: /Keep going \(\+4 rounds\)/ });
    await expect(keepGoing).toBeVisible();
    await expect(checkpoint.getByRole('button', { name: /Accept as is/ })).toBeVisible();
    await checkpoint.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/plan-checkpoint.png' });

    // 5. Keep going grants another batch; the build finishes and is recorded.
    await keepGoing.click();
    await expect(panel.getByText('Bust done.')).toBeVisible({ timeout: 60_000 });
    expect(buildCalls).toBe(5);
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem('partwright.planCalibration') ?? '[]'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ difficulty: 'hard', roundsMin: 2, roundsMax: 3, actualRounds: 5, checkpoints: 1, outcome: 'completed' });
  });

  test('"don\'t ask again" remembers the style and skips the picker', async ({ page }) => {
    test.setTimeout(120_000);
    const bodies: AnthropicBody[] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      bodies.push(route.request().postDataJSON() as AnthropicBody);
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: toolReply(`p${bodies.length}`, 'proposePlan', PLAN_INPUT) });
    });
    await setUp(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    await input.fill('A gear');
    await input.press('Enter');
    const picker = panel.locator('[data-plan-style-picker]');
    // Escape cancels and keeps the message; sending again re-asks.
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(input).toHaveValue('A gear');
    await input.press('Enter');
    await expect(picker).toBeVisible();
    await picker.getByRole('checkbox').check();
    await picker.locator('[data-plan-style="compare"]').click();
    await expect(panel.locator('[data-plan-card]')).toBeVisible({ timeout: 30_000 });
    expect(userText(bodies[0])).toContain('lay out 2–3 genuinely different ways');
    const prefs = await page.evaluate(async () => {
      const s = await import('/src/ai/settings.ts');
      const { planStyle, askPlanStyle } = s.loadSettings();
      return { planStyle, askPlanStyle };
    });
    expect(prefs).toEqual({ planStyle: 'compare', askPlanStyle: false });
  });
});
