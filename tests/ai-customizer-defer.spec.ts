import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// When the AI generates a customizable model mid-turn (a runAndSave during a
// chat response), the Customizer reveal is held back so it doesn't pop over the
// live chat or pull the AI panel aside. Once the turn ends it reveals *silently*
// — the panel appears AND the AI drawer stays open, so the user sees the result
// and its knobs together. (Contrast tests/customizer.spec.ts, where a user-driven
// run with the AI idle hides the AI panel.) Drives a real Anthropic turn through
// the agent Worker with the provider request stubbed via page.route.

const PARAM_MODEL = "const { Manifold } = api; const p = api.params({ width: { type: 'number', default: 20, min: 10, max: 100 } }); return Manifold.cube([p.width, p.width, p.width], true);";

function sse(lines: string[]): string { return lines.join('\n') + '\n\n'; }

const toolUseTurn = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_ras","name":"runAndSave","input":{}}}',
  '',
  'event: content_block_delta',
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(JSON.stringify({ code: PARAM_MODEL, label: 'cube' }))}}}`,
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":8}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
];

const endTurn = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Built a customizable cube."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
];

test('AI turn defers Customizer, keeps pane', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });

  let call = 0;
  await page.route('**/v1/messages*', async (route) => {
    const body = sse(call++ === 0 ? toolUseTurn : endTurn);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });

  await page.goto('/editor');
  await waitForEditorReady(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('partwright');
      open.onsuccess = () => {
        const db = open.result;
        const txn = db.transaction('aiKeys', 'readwrite');
        txn.objectStore('aiKeys').put({ provider: 'anthropic', apiKey: 'sk-ant-test-0000', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
        txn.oncomplete = () => { db.close(); resolve(); };
        txn.onerror = () => reject(txn.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await waitForEditorReady(page);
  await openAiPanel(page);
  const settings = page.getByRole('heading', { name: 'AI Settings' });
  if (await settings.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); }

  const input = page.locator('#ai-panel textarea');
  await input.fill('make a customizable cube');
  await input.press('Enter');

  // After the turn ends: Customizer revealed, AND the AI panel stayed open.
  await expect(page.locator('#params-panel')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('#ai-panel')).toBeVisible();
});
