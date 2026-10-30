import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// A High-thinking step that spends its whole output allowance thinking stops
// with max_tokens and nothing to show. That reasoning can't be resumed, so:
//  • the notice says so and leads with "Retry at <one level lower> thinking";
//  • High+ turns ask for the 1-hour prompt cache (a 5-minute think otherwise
//    expires the cache and the next step re-writes the whole conversation);
//  • the AI Call Log shows the cache write + cost, and survives a reload.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const MODEL = 'claude-opus-5-5';
const usageStart = { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 158_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 158_000 } };

/** Thinks, then hits max_tokens before writing any text or tool call. */
const thinkingCutoff = sse([
  ['message_start', { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: usageStart } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Weighing how to rebuild the mask from the mesh…' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 32_768 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const textReply = sse([
  ['message_start', { type: 'message_start', message: { id: 'm2', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 158_000, cache_creation_input_tokens: 300 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Plan: three steps.' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }],
  ['message_stop', { type: 'message_stop' }],
]);

interface AnthropicBody {
  system: Array<{ cache_control?: { type: string; ttl?: string } }>;
  output_config?: { effort?: string };
}

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
    s.saveSettings(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: model, thinking: 'high', maxSpend: 'high', autoReview: false, autoResume: false, planFirst: false }));
  }, MODEL);
  await page.reload();
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await openAiPanel(page);
  const heading = page.getByRole('heading', { name: 'AI Settings' });
  if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

test.describe('AI thinking cut-off', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  });

  test('offers a lower-thinking retry, uses the 1-hour cache at High, and logs cache writes', async ({ page }) => {
    test.setTimeout(150_000);
    const bodies: AnthropicBody[] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      bodies.push(route.request().postDataJSON() as AnthropicBody);
      const body = bodies.length === 1 ? thinkingCutoff : textReply;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
    });

    await setUp(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    await input.fill('Rebuild the mask from the imported mesh');
    await input.press('Enter');

    await expect(panel.getByText('Ran out of room while thinking', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('can\'t be picked up again', { exact: false })).toBeVisible();
    const retry = panel.getByRole('button', { name: '↻ Retry at Med thinking' });
    await expect(retry).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Keep going at this level' })).toBeVisible();
    await page.screenshot({ path: 'test-results/thinking-cutoff-notice.png' });

    // The High turn asked for the 1-hour cache on its breakpoints.
    expect(bodies[0].output_config?.effort).toBe('high');
    expect(bodies[0].system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // Retrying lowers Thinking to Medium (and the 5-minute cache) for the rerun.
    await retry.click();
    await expect(panel.getByText('Plan: three steps.')).toBeVisible({ timeout: 30_000 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].output_config?.effort).toBe('medium');
    expect(bodies[1].system[0].cache_control).toEqual({ type: 'ephemeral' });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('partwright-ai-settings-v1') || '{}').toggles?.thinking);
    expect(stored).toBe('medium');

    // The call log shows the cache write and the call's cost …
    const openLog = async () => {
      await panel.locator('button[title^="AI Call Log"]').dispatchEvent('click');
      const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Call Log' });
      await expect(modal).toBeVisible();
      return modal;
    };
    let modal = await openLog();
    const cutoffRow = modal.locator('details').filter({ hasText: 'stop: max_tokens' });
    await expect(cutoffRow).toContainText('158000t cache write');
    await expect(cutoffRow).toContainText('$');
    await cutoffRow.locator('summary').click();
    await expect(cutoffRow).toContainText('158000 cache write (158000 at 1h)');
    await page.screenshot({ path: 'test-results/thinking-cutoff-call-log.png' });

    // … and survives a reload of the tab.
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    modal = await openLog();
    await expect(modal.locator('details').filter({ hasText: 'stop: max_tokens' })).toHaveCount(1);
  });
});
