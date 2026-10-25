import { test, expect } from 'playwright/test';
import { openAiPanel } from './helpers/aiPanel';

// Custom endpoint context profile: Connect detects a small llama.cpp window,
// Auto picks the Slim prompt, and the activated toggles send the slim prompt
// + reduced tool set instead of the ~100k-token hosted payload.

test.describe('AI custom endpoint context size', () => {
  test('Connect detects the window; Auto → Slim; manual window and tier stick', async ({ page }) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await page.route('http://localhost:9912/v1/models', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ data: [{ id: 'qwen3-8b-q4', meta: { n_ctx_train: 131072 } }] }),
    }));
    await page.route('http://localhost:9912/props', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ default_generation_settings: { n_ctx: 16384 } }),
    }));
    await page.route(/localhost:9912\/api\//, route => route.fulfill({ status: 404, headers: cors, body: '' }));

    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Settings' });
    await page.locator('button:has-text("Custom (OpenAI)")').dispatchEvent('click');

    await modal.getByRole('button', { name: '+ Other endpoint' }).click();
    const urlInput = modal.getByTestId('custom-endpoint-url');
    await urlInput.fill('http://localhost:9912/v1');
    await urlInput.blur();

    // Before Connect: window unknown → Auto means Full.
    const ctx = modal.getByTestId('custom-context');
    await expect(ctx.getByRole('button', { name: 'Auto (full)' })).toBeVisible();

    await modal.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(modal.getByText('Context window: 16,384 tokens.', { exact: false })).toBeVisible();
    // n_ctx from /props, not the training length from /v1/models meta.
    await expect(modal.getByTestId('custom-context-window')).toHaveAttribute('placeholder', '16384');
    await expect(ctx.getByText('detected for qwen3-8b-q4', { exact: false })).toBeVisible();
    await expect(ctx.getByRole('button', { name: 'Auto (slim)' })).toBeVisible();
    await ctx.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/custom-context-detected.png' });

    // Choosing Full on a 16k window warns that it won't fit.
    await ctx.getByRole('button', { name: /^Full / }).click();
    await expect(modal.getByTestId('custom-context-overflow')).toBeVisible();
    await page.screenshot({ path: 'test-results/custom-context-overflow.png' });
    await ctx.getByRole('button', { name: 'Auto (slim)' }).click();

    // A typed window overrides the detected one.
    const win = modal.getByTestId('custom-context-window');
    await win.fill('65536');
    await win.blur();
    await expect(ctx.getByRole('button', { name: 'Auto (medium)' })).toBeVisible();
    await expect(ctx.getByText('you set it', { exact: false })).toBeVisible();
    await win.fill('');
    await win.blur();
    await expect(ctx.getByRole('button', { name: 'Auto (slim)' })).toBeVisible();

    await page.getByRole('button', { name: 'Save & activate Custom endpoint' }).click();
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toHaveCount(0);

    // What the chat loop would send with the activated toggles.
    const sent = await page.evaluate(async () => {
      const settings = await import('/src/ai/settings.ts');
      const chatLoop = await import('/src/ai/chatLoop.ts');
      const tools = await import('/src/ai/tools.ts');
      const cc = await import('/src/ai/customContext.ts');
      const t = settings.loadSettings().toggles;
      const prompt = await chatLoop.buildActiveSystemPrompt(t);
      const list = cc.toolsForCustomTier(tools.buildToolList(t), cc.resolveCustomPromptTier(t));
      return { provider: t.provider, context: t.customContext, promptChars: prompt.length, toolCount: list.length };
    });
    expect(sent.provider).toBe('custom');
    expect(sent.context.modelWindows).toEqual({ 'qwen3-8b-q4': 16384 });
    expect(sent.promptChars).toBeLessThan(10_000);
    expect(sent.toolCount).toBeLessThanOrEqual(25);

    // The panel's prompt chip says so too.
    await expect(page.locator('#ai-panel').getByRole('button', { name: '· Slim prompt' })).toBeVisible();
    await page.screenshot({ path: 'test-results/custom-context-panel.png' });

  });
});
