import { test, expect, type Page } from 'playwright/test';
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

const toolReply = (id: string, name: string, input: unknown) => sse([
  ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
  ['message_stop', { type: 'message_stop' }],
]);

const ASK_INPUT = { questions: [
  { question: 'How tall should the vase be?', options: [{ label: '60 mm (recommended)' }, { label: '100 mm', description: 'needs a wider base' }] },
  { question: 'Which extras?', options: [{ label: 'Handle' }, { label: 'Spout' }, { label: 'Lid' }], multiSelect: true },
] };
const PLAN_INPUT = {
  summary: 'A 60 mm tall vase with a handle, revolved from a spline profile.',
  steps: ['Revolve a 60 mm spline profile.', 'Hollow it with 2 mm walls.', 'Sweep a C-shaped handle and union it on.'],
  assumptions: ['Units are mm.', 'Open top, no lid.'],
};

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

async function setUpAnthropic(page: Page, planFirst: boolean): Promise<void> {
  await page.goto('/editor');
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await page.evaluate(async (plan) => {
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
    // Quick plan without the planning-style picker (ai-plan-estimate.spec covers it).
    s.saveSettings(s.setPlanStylePrefs(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', thinking: 'off', autoReview: false, autoResume: false, planFirst: plan }), { planStyle: 'quick', askPlanStyle: false }));
  }, planFirst);
  await page.reload();
  await waitForEditorReady(page);
  await waitForChatSessionId(page);
  await openAiPanel(page);
  const heading = page.getByRole('heading', { name: 'AI Settings' });
  if (await heading.isVisible().catch(() => false)) await page.keyboard.press('Escape');
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

    await setUpAnthropic(page, true);

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

  test('card tools: questions card, plan card, survives reload, Build sends the plan', async ({ page }) => {
    test.setTimeout(180_000);
    const bodies: AnthropicBody[] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as AnthropicBody;
      bodies.push(body);
      const n = bodies.length;
      // Gemini/local number tool calls per response, so reuse one id to
      // check cards are told apart by message, not just call id.
      const reply = n === 1 ? toolReply('same', 'askUser', ASK_INPUT)
        : n === 2 ? toolReply('plan', 'proposePlan', PLAN_INPUT)
          : n === 3 ? toolReply('same', 'askUser', { questions: [{ question: 'Glaze finish?', options: [{ label: 'Matte' }, { label: 'Gloss' }] }] })
            : textReply(`m${n}`, 'Built the vase.');
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });
    await setUpAnthropic(page, true);

    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    const bar = panel.locator('[data-plan-state]');

    // 1. The model asks with a card; the turn ends there (one request).
    await input.fill('Make me a vase');
    await input.press('Enter');
    const card = panel.locator('[data-ask-user-card]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(bar).toHaveAttribute('data-plan-state', 'questions');
    expect(bodies).toHaveLength(1);
    expect((bodies[0].tools ?? []).map(t => t.name)).toEqual(expect.arrayContaining(['askUser', 'proposePlan']));
    // The card's acknowledgement isn't shown as a tool-result chip.
    await expect(panel.getByText('Shown to the user as a card', { exact: false })).toHaveCount(0);
    await card.getByRole('button', { name: /60 mm/ }).click();
    // Toggling a chip keeps keyboard focus on it.
    await expect(card.getByRole('button', { name: /60 mm/ })).toBeFocused();
    await card.getByRole('button', { name: 'Handle' }).click();
    await card.getByRole('button', { name: 'Lid' }).click();
    await expect(card.getByRole('button', { name: 'Lid' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: 'test-results/plan-cards-questions.png' });

    // 2. Send answers → a plan revision carrying them; the model proposes a plan.
    await card.getByRole('button', { name: 'Send answers' }).click();
    const planCard = panel.locator('[data-plan-card]');
    await expect(planCard).toBeVisible({ timeout: 30_000 });
    const answerTurn = lastUserText(bodies[1]);
    expect(answerTurn).toContain('[Plan refinement');
    expect(answerTurn).toContain('- How tall should the vase be? → 60 mm');
    expect(answerTurn).toContain('- Which extras? → Handle, Lid');
    await expect(planCard.locator('li')).toHaveCount(5);
    await expect(bar).toHaveAttribute('data-plan-state', 'plan');
    // The answered card is no longer interactive.
    await expect(card.getByRole('button', { name: /60 mm/ })).toBeDisabled();
    await page.screenshot({ path: 'test-results/plan-cards-plan.png' });

    // 3. The pending plan survives a reload; the Plan pill turns it off and on.
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    await expect(panel.locator('[data-plan-card]')).toBeVisible({ timeout: 30_000 });
    const planBar = panel.locator('[data-plan-state]');
    await expect(planBar).toHaveAttribute('data-plan-state', 'plan');
    const pill = panel.getByRole('button', { name: /📋 Plan/ });
    await pill.click();
    await expect(planBar).toBeHidden();
    await expect(panel.locator('[data-plan-card]')).toBeVisible();
    await pill.click();
    await expect(planBar).toBeVisible();

    // 4. Build sends the plan as Markdown with the full tool list.
    await planBar.getByRole('button', { name: /Build it/ }).click();
    const buildCard = panel.locator('[data-ask-user-card]').last();
    await expect(buildCard).toContainText('Glaze finish?', { timeout: 30_000 });
    const build = bodies[2];
    expect(lastUserText(build)).toContain('[Plan approved');
    expect(lastUserText(build)).toContain('2. Hollow it with 2 mm walls.');
    expect(lastUserText(build)).toContain('- Open top, no lid.');
    const buildTools = (build.tools ?? []).map(t => t.name);
    expect(buildTools).toContain('runAndSave');
    expect(buildTools).not.toContain('proposePlan');

    // 5. A question during the build: only the newest card is live, and the
    //    answer continues the build (full tools, no plan wrapping) even with
    //    the Plan pill on.
    await expect(panel.locator('[data-ask-user-card]').first().getByRole('button', { name: /60 mm/ })).toBeDisabled();
    await buildCard.getByRole('button', { name: 'Matte' }).click();
    await expect(panel.getByText('Built the vase.')).toBeVisible({ timeout: 30_000 });
    const answer = bodies[3];
    expect(lastUserText(answer)).toBe('- Glaze finish? → Matte');
    expect((answer.tools ?? []).map(t => t.name)).toContain('runAndSave');
    await expect(planBar).toBeHidden();
  });

  test('askUser outside plan mode: one click answers a single question', async ({ page }) => {
    test.setTimeout(150_000);
    const bodies: AnthropicBody[] = [];
    await page.route('https://api.anthropic.com/**', async route => {
      const body = route.request().postDataJSON() as AnthropicBody;
      bodies.push(body);
      const reply = bodies.length === 1
        ? toolReply('ask1', 'askUser', { questions: [{ question: 'Add a lid?', options: [{ label: 'No lid (recommended)' }, { label: 'Snap-on lid' }] }] })
        : textReply(`m${bodies.length}`, 'Okay, no lid.');
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: reply });
    });
    await setUpAnthropic(page, false);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    await input.fill('Make me a vase');
    await input.press('Enter');
    const card = panel.locator('[data-ask-user-card]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-plan-state]')).toBeHidden();
    await expect(card.getByRole('button', { name: 'Send answers' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/ask-user-chat.png' });
    await card.getByRole('button', { name: /No lid/ }).click();
    await expect(panel.getByText('Okay, no lid.')).toBeVisible({ timeout: 30_000 });
    expect(lastUserText(bodies[1])).toBe('- Add a lid? → No lid');
  });
});
