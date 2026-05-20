import { test, expect } from 'playwright/test';

// Regression coverage for the multi-provider extension to the in-app
// chat. The base in-browser AI surface (Anthropic + Local) has its own
// smoke tests; these focus on the hosted-provider additions (OpenAI,
// Gemini), the Review modal, and the Diagnostics view.

test.describe('Multi-provider AI', () => {
  test('settings modal has a tab per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    // Open AI Settings via the cog icon (its title starts with "AI settings").
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    // The modal is tabbed by provider — one tab per provider. Only the
    // viewed tab's section renders, so we assert the tab strip has all
    // four, then walk each hosted tab and confirm its Connect button.
    const tabLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').trim())
    );
    expect(tabLabels.some(l => /^Anthropic \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^OpenAI \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Gemini \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Local \(WebGPU\)/.test(l))).toBe(true);

    // Scope to the modal shell — "Connect Anthropic API" also appears in
    // the panel's not-connected banner, which would trip strict mode.
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Settings' });
    // Anthropic tab is shown by default (fresh user → active provider).
    await expect(modal.locator('button:has-text("Connect Anthropic API")')).toBeVisible();
    // Switch to the OpenAI tab → its Connect button appears.
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await expect(modal.locator('button:has-text("Connect OpenAI")')).toBeVisible();
    // Switch to the Gemini tab → its Connect button appears.
    await page.locator('button:has-text("Gemini (cloud)")').dispatchEvent('click');
    await expect(modal.locator('button:has-text("Connect Google Gemini")')).toBeVisible();
  });

  test('panel header model picker switches per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');

    // Default provider is Anthropic — dropdown shows claude-* models.
    const headerModel = page.locator('#ai-panel select').first();
    const anthropicOpts = await headerModel.evaluate(
      (el: HTMLSelectElement) => Array.from(el.options).map(o => o.value),
    );
    expect(anthropicOpts.some(o => o.startsWith('claude-'))).toBe(true);

    // Switch settings → OpenAI, then verify the dropdown rewrites.
    await page.evaluate(() => {
      const raw = localStorage.getItem('partwright-ai-settings-v1');
      const cur = raw ? JSON.parse(raw) : {};
      cur.toggles = cur.toggles ?? {};
      cur.toggles.provider = 'openai';
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify(cur));
    });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    const openaiOpts = await page.locator('#ai-panel select').first().evaluate(
      (el: HTMLSelectElement) => Array.from(el.options).map(o => o.value),
    );
    expect(openaiOpts.some(o => o.startsWith('gpt') || o === 'o3')).toBe(true);

    // Same for Gemini.
    await page.evaluate(() => {
      const raw = localStorage.getItem('partwright-ai-settings-v1');
      const cur = raw ? JSON.parse(raw) : {};
      cur.toggles = cur.toggles ?? {};
      cur.toggles.provider = 'gemini';
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify(cur));
    });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    const geminiOpts = await page.locator('#ai-panel select').first().evaluate(
      (el: HTMLSelectElement) => Array.from(el.options).map(o => o.value),
    );
    expect(geminiOpts.some(o => o.startsWith('gemini'))).toBe(true);
  });

  test('per-provider model is preserved across provider switches', async ({ page }) => {
    // Saved settings hold an openaiModel + geminiModel + anthropicModel
    // independently. Switching the active provider must NOT lose the
    // other providers' chosen ids (this was a bug in the v1 PR).
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.evaluate(() => {
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({
        preset: 'custom',
        drawerOpen: true,
        autoCompactMode: 'off',
        systemPromptOverrides: { anthropic: null, local: null, openai: null, gemini: null },
        customLocalModels: [],
        localContext: { windowSizeOverride: null, sliding: false },
        toggles: {
          vision: { views: true },
          scope: { runCode: true, saveVersions: true, paintFaces: false },
          autoRetry: 1,
          maxIterations: 'medium',
          maxSpend: 'medium',
          provider: 'openai',
          anthropicModel: 'claude-opus-4-7',
          localModel: null,
          openaiModel: 'gpt-5-nano',
          geminiModel: 'gemini-2.5-pro',
        },
      }));
    });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    // Header shows OpenAI's chosen model.
    await expect(page.locator('#ai-panel select').first()).toHaveValue('gpt-5-nano');
    // Flip the active provider to Anthropic via the tabbed settings modal:
    // view the Anthropic tab, then click its "Enable" button.
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    await page.locator('button:has-text("Anthropic (cloud)")').dispatchEvent('click');
    await page.locator('button:has-text("Enable Anthropic Claude")').dispatchEvent('click');
    await page.waitForTimeout(200);
    // Close the modal via the shell ✕ and confirm the header restored the
    // previously-chosen Anthropic model (not reset to the preset default).
    await page.locator('.bg-zinc-800.rounded-xl button:has-text("✕")').first().dispatchEvent('click');
    await expect(page.locator('#ai-panel select').first()).toHaveValue('claude-opus-4-7');
  });

  test('Review button opens the review modal', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    await page.locator('#ai-panel button[title^="Get a second opinion"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Get a second opinion' })).toBeVisible();
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'Get a second opinion' });
    await expect(modal.locator('button:has-text("Run review")')).toBeVisible();
    await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();
  });

  test('Diagnostics modal renders empty state', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    await page.locator('#ai-panel button[title^="AI Call Log"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Call Log' })).toBeVisible();
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Call Log' });
    await expect(modal.locator('text=No AI calls have been made')).toBeVisible();
    await expect(modal.locator('button:has-text("Clear")')).toBeVisible();
    await expect(modal.locator('button:has-text("Copy JSON")')).toBeVisible();
  });

  test('Diagnostics modal renders recorded events', async ({ page }) => {
    // Seeds two events via a dynamic import of the diagnostics module
    // (chatLoop records the same way). Asserts both show with the error
    // event auto-expanded so the full message is visible on open.
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.evaluate(async () => {
      const mod = await import('/src/ai/diagnostics.ts');
      mod.clearEvents();
      mod.recordEvent({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        kind: 'streamTurn',
        durationMs: 250,
        status: 'ok',
        stopReason: 'end_turn',
        inputTokens: 12_500,
        outputTokens: 0,
        textPreview: '',
        requestSummary: '2 msg(s), 30 tool def(s), vision=on',
      });
      mod.recordEvent({
        provider: 'openai',
        model: 'gpt-5-mini',
        kind: 'streamTurn',
        durationMs: 180,
        status: 'error',
        errorMessage: 'OpenAI 401: Invalid API key supplied.',
        requestSummary: '3 msg(s), 30 tool def(s)',
      });
    });
    await page.locator('#btn-ai').dispatchEvent('click');
    await page.locator('#ai-panel button[title^="AI Call Log"]').dispatchEvent('click');
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Call Log' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('text=2 event(s)')).toBeVisible();
    await expect(modal.locator('text=1 error(s)')).toBeVisible();
    // Error event auto-expands, so the full error message body should
    // be in the DOM. It appears twice (truncated summary + full pre);
    // assert the <pre> rendering specifically.
    await expect(modal.locator('pre', { hasText: 'OpenAI 401: Invalid API key supplied.' })).toBeVisible();
    await expect(modal.locator('text=stop: end_turn')).toBeVisible();
  });

  test('connect modal renders correctly per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    // Tabbed modal — view the OpenAI tab first, then its Connect button.
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await page.locator('button:has-text("Connect OpenAI")').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Connect OpenAI' })).toBeVisible();
    await expect(page.locator('input[placeholder*="sk-proj"]')).toBeVisible();
    await expect(page.locator('a[href*="platform.openai.com"]')).toBeVisible();
  });
});
