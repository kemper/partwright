import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// Golden path for the automatic end-of-task review: the agent builds
// something (a tool call), the fresh-context reviewer says "needs rework",
// the agent gets one fix round, and the second review passes.

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}
const start = (id: string) => ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 1 } } }] as [string, unknown];
const end = (reason: string) => [
  ['message_delta', { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 60 } }],
  ['message_stop', { type: 'message_stop' }],
] as Array<[string, unknown]>;
const textReply = (id: string, text: string) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ...end('end_turn'),
]);
const toolReply = (id: string, input: Record<string, unknown>) => sse([
  start(id),
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name: 'runAndSave', input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ...end('tool_use'),
]);

// Blind holes first (cylinders too short to cut through), through-holes after the fix.
const BLIND = "const { Manifold } = api; const plate = Manifold.cube([40, 20, 4]); const hole = Manifold.cylinder(2, 2.5, 2.5, 32); return plate.subtract(hole.translate([8, 10, 2])).subtract(hole.translate([32, 10, 2]));";
const THROUGH = "const { Manifold } = api; const plate = Manifold.cube([40, 20, 4]); const hole = Manifold.cylinder(6, 2.5, 2.5, 32); return plate.subtract(hole.translate([8, 10, -1])).subtract(hole.translate([32, 10, -1]));";

// A 1×1 PNG standing in for a reference photo the user attached earlier.
const REF_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function seedAnthropic(page: Page): Promise<void> {
  const sid = await waitForChatSessionId(page);
  await page.evaluate(async ({ sid, png }) => {
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
    let st = s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', thinking: 'off', autoReview: true });
    st = s.setAutoReview(st, { provider: 'same', fixRounds: 1 });
    s.saveSettings(st);
    // An earlier turn where the user attached a reference image.
    const db = await import('/src/ai/db.ts');
    await db.putMessages([
      { id: 'ref1', sessionId: sid, role: 'user', createdAt: 1, seq: 1, blocks: [{ type: 'text', text: 'Here is the bracket I want to copy' }, { type: 'image', source: { data: png, mediaType: 'image/png', label: 'bracket.png' } }] },
      { id: 'ref2', sessionId: sid, role: 'assistant', createdAt: 2, seq: 2, blocks: [{ type: 'text', text: 'Got it.' }] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
  }, { sid, png: REF_PNG });
}

test.describe('Automatic end-of-task review', () => {
  test('reviews a finished task, hands a failing review back for one fix round, then passes', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
    let reviews = 0;
    let chatCalls = 0;
    const reviewImages: string[][] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as { system?: Array<{ text: string }>; messages: Array<{ role: string; content: unknown }> };
      const system = (body.system ?? []).map(b => b.text).join('\n');
      let reply: string;
      if (system.includes('senior CAD reviewer')) {
        reviews++;
        const blocks = body.messages[0].content as Array<{ type: string; source?: { data?: string } }>;
        reviewImages.push(blocks.filter(b => b.type === 'image').map(b => b.source?.data ?? ''));
        reply = reviews === 1
          ? textReply('rev1', 'Verdict: needs rework\nThe two Ø5 holes are blind: the cylinders are 2 tall starting at z=2, so they stop at the top face instead of cutting through the 4 mm plate. Make them ≥6 tall and start at z=-1.')
          : textReply('rev2', 'Verdict: pass\nBoth holes now cut fully through the plate; dimensions match the request.');
      } else {
        chatCalls++;
        const last = body.messages[body.messages.length - 1];
        const lastIsToolResult = Array.isArray(last.content) && (last.content as Array<{ type: string }>).some(b => b.type === 'tool_result');
        const inFixRound = JSON.stringify(body.messages).includes('[Automatic review]');
        reply = lastIsToolResult
          ? textReply(`end${chatCalls}`, inFixRound ? 'Fixed — the holes now run the full plate thickness (6 tall from z=-1).' : 'Built the 40×20×4 bracket with two Ø5 holes.')
          : toolReply(`t${chatCalls}`, { code: inFixRound ? THROUGH : BLIND, label: inFixRound ? 'through holes' : 'bracket' });
      }
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });

    await page.goto('/editor');
    await waitForEditorReady(page);
    await seedAnthropic(page);
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');

    // The 🔍 Review pill reflects the setting.
    await expect(page.locator('#ai-panel button', { hasText: '🔍 Review' })).toBeVisible();

    const input = page.locator('#ai-panel textarea');
    await input.fill('Make a 40×20×4 mounting plate with two Ø5 through-holes');
    await input.press('Enter');

    const panel = page.locator('#ai-panel');
    await expect(panel.getByText('Verdict: pass')).toBeVisible({ timeout: 60_000 });
    // The review appears once, as its own block; the follow-up turn points at
    // it rather than repeating it (providers replay review blocks already).
    await expect(panel.getByText(/Verdict: needs rework/)).toHaveCount(1);
    await expect(panel.getByText(/\[Automatic review\] The review above/)).toBeVisible();
    await expect(panel.getByText(/Fixed — the holes now run/)).toBeVisible();
    expect(reviews).toBe(2);
    // The reviewer sees the user's reference image next to the render.
    for (const imgs of reviewImages) expect(imgs).toContain(REF_PNG);
    // Exactly one fix round: build (2 calls) + fix (2 calls).
    expect(chatCalls).toBe(4);
    await page.screenshot({ path: 'test-results/auto-review.png' });
  });

  test('the review prompt is visible and editable in AI Settings, and the reviewer receives the edit', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
    const reviewerSystems: string[] = [];
    let chatCalls = 0;
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as { system?: Array<{ text: string }>; messages: Array<{ role: string; content: unknown }> };
      const system = (body.system ?? []).map(b => b.text).join('\n');
      let reply: string;
      // The fixed output contract is appended to every review, custom or not.
      if (system.includes('Verdict: needs rework')) {
        reviewerSystems.push(system);
        reply = textReply('rev', 'Verdict: pass\nBoth holes cut through; the plate is 40×20×4.');
      } else {
        chatCalls++;
        const last = body.messages[body.messages.length - 1];
        const lastIsToolResult = Array.isArray(last.content) && (last.content as Array<{ type: string }>).some(b => b.type === 'tool_result');
        reply = lastIsToolResult ? textReply(`end${chatCalls}`, 'Built the plate.') : toolReply(`t${chatCalls}`, { code: THROUGH, label: 'plate' });
      }
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });

    await page.goto('/editor');
    await waitForEditorReady(page);
    await seedAnthropic(page);
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    const heading = page.getByRole('heading', { name: 'AI Settings' });
    if (!(await heading.isVisible().catch(() => false))) {
      await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    }
    await expect(heading).toBeVisible();

    // The built-in prompt is shown in full; replace it with a custom rubric.
    await page.getByRole('button', { name: 'View / edit review prompt' }).click();
    await expect(page.getByRole('heading', { name: 'Review prompt' })).toBeVisible();
    const editor = page.getByTestId('review-prompt-text');
    await expect(editor).toHaveValue(/senior CAD reviewer/);
    await expect(page.getByTestId('review-prompt-state')).toHaveText('Built-in default');
    await editor.fill('Only check that every hole goes all the way through.');
    await expect(page.getByTestId('review-prompt-state')).toHaveText('Custom (override)');
    await page.screenshot({ path: 'test-results/review-prompt-editor.png' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect(await page.evaluate(async () => (await import('/src/ai/settings.ts')).loadSettings().reviewPromptOverride))
      .toBe('Only check that every hole goes all the way through.');

    const input = page.locator('#ai-panel textarea');
    await input.fill('Make a 40×20×4 plate with two Ø5 through-holes');
    await input.press('Enter');
    await expect(page.locator('#ai-panel').getByText('Verdict: pass')).toBeVisible({ timeout: 60_000 });
    expect(reviewerSystems).toHaveLength(1);
    expect(reviewerSystems[0].startsWith('Only check that every hole goes all the way through.')).toBe(true);
    expect(reviewerSystems[0]).not.toContain('senior CAD reviewer');
  });
});
