import { test, expect } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

// Regression coverage for the multi-provider extension to the in-app
// chat. The base in-browser AI surface (Anthropic + Local) has its own
// smoke tests; these focus on the hosted-provider additions (OpenAI,
// Gemini), the Review modal, and the Diagnostics view.

test.describe('Multi-provider AI', () => {
  test('thinking block renders as a collapsible box, separate from the answer', async ({ page }) => {
    // A persisted assistant turn with a thinking block should render the
    // reasoning in a collapsed expand/contract box (hidden until clicked),
    // with the answer in its own bubble.
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    // Bare /editor auto-restores a session (id in the URL, stable across
    // reload), so the chat pins to that bucket — seed there, not global. The
    // session is created after WASM init, so wait for it before seeding or the
    // message lands in the global bucket and the reload restore never shows it.
    const sid = await waitForChatSessionId(page);
    await page.evaluate(async ({ sid }) => {
      const db = await import('/src/ai/db.ts');
      await db.putMessages([{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: 'm-think-1', sessionId: sid, role: 'assistant',
        blocks: [
          { type: 'thinking', text: 'Reasoning: the winding order must be CCW.' },
          { type: 'text', text: 'Done — created the sphere.' },
        ],
        createdAt: Date.now(), seq: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any]);
    }, { sid });
    await page.reload();
    // After the reload, the AI panel attaches to the DOM almost immediately,
    // but its transcript stays empty until the editor is past WASM init AND
    // the session has reopened — that's what fires onStateChange →
    // setAiActiveSession(sid) → loadHistoryForCurrentSession. Wait for "Ready"
    // (which gates session open) before checking the transcript, otherwise on
    // a slow CI runner the default 5s expect timeout can lapse before the
    // seeded message renders.
    await waitForEditorReady(page);
    await openAiPanel(page);
    const box = page.locator('#ai-panel details').filter({ hasText: '🧠 Thinking' });
    await expect(box).toBeVisible({ timeout: 15_000 });
    // The answer is in its own bubble, visible without expanding anything.
    await expect(page.locator('#ai-panel').getByText('Done — created the sphere.')).toBeVisible();
    // Reasoning is hidden (collapsed) until the box is expanded.
    await expect(box.locator('pre')).toBeHidden();
    await box.locator('summary').dispatchEvent('click');
    await expect(box.locator('pre')).toBeVisible();
    await expect(box.locator('pre')).toContainText('winding order must be CCW');
  });

  test('Thinking pill is in the toggle strip, defaults High, and persists', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    // Thinking lives in the collapsible ⚙ Options group (advanced knobs are
    // hidden by default to keep the panel uncluttered) — expand it first.
    await page.locator('#ai-panel button:has-text("⚙ Options")').dispatchEvent('click');
    const thinkSel = page.locator('#ai-panel select[title^="Thinking:"]');
    await expect(thinkSel).toBeVisible();
    // Thinking now ships on by default (the standard preset uses 'high').
    await expect(thinkSel).toHaveValue('high');
    await thinkSel.selectOption('off');
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('partwright-ai-settings-v1') || '{}').toggles?.thinking,
    );
    expect(stored).toBe('off');
  });

  test('settings modal has a tab per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    // Open AI Settings via the cog icon (its title starts with "AI settings").
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    // The modal is tabbed by provider — one tab per provider. Only the
    // viewed tab's section renders, so we assert the tab strip has all
    // five, then walk each hosted tab and confirm its Connect button.
    const tabLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').trim())
    );
    expect(tabLabels.some(l => /^Anthropic \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^OpenAI \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Gemini \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Custom \(OpenAI\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Local \(WebGPU\)/.test(l))).toBe(true);

    // Scope to the modal shell so the assertions can't accidentally match
    // any same-named control elsewhere on the page.
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

  test('Custom tab configures a self-hosted endpoint and gates Enable on the URL', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();

    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Settings' });
    await page.locator('button:has-text("Custom (OpenAI)")').dispatchEvent('click');

    // The custom config UI renders: base URL input + the connection helpers.
    const urlInput = modal.locator('input[placeholder="http://localhost:8080/v1"]');
    await expect(urlInput).toBeVisible();
    await expect(modal.locator('button:has-text("Test connection")')).toBeVisible();
    await expect(modal.locator('button:has-text("Fetch models")')).toBeVisible();

    // Enable is gated on the endpoint URL (the API key is optional). The URL
    // ships pre-filled with the bridge default, so Enable starts ready;
    // clearing the URL gates it off, and refilling flips it back on — no key
    // required.
    const enableBtn = modal.getByRole('button', { name: 'Enable Custom endpoint', exact: true });
    await expect(urlInput).toHaveValue('http://localhost:8317/v1');
    await expect(enableBtn).toBeEnabled();
    await urlInput.fill('');
    await urlInput.blur();
    await expect(enableBtn).toBeDisabled();
    await urlInput.fill('http://localhost:8080/v1');
    await urlInput.blur();
    await modal.locator('input[placeholder^="e.g. llama"]').fill('my-model');
    await expect(enableBtn).toBeEnabled();
  });

  test('Custom tab: fetched models surface in the panel dropdown; Save & activate flushes the typed key', async ({ page }) => {
    // Mock the OpenAI-compatible /models endpoint so "Fetch models" returns a list.
    await page.route('**/v1/models', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'llama-3.3-70b-instruct' }, { id: 'qwen2.5-coder-32b' }] }),
    }));

    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);

    // Open settings via the panel's ⚙ button so the real onChange (which
    // re-renders the model picker) is wired.
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Settings' });
    await page.locator('button:has-text("Custom (OpenAI)")').dispatchEvent('click');

    const urlInput = modal.locator('input[placeholder="http://localhost:8080/v1"]');
    await urlInput.fill('http://localhost:9911/v1');
    await urlInput.blur(); // commit the URL (its onChange fires on blur)

    // Footer parity with the cloud tabs: Close + Save + Save & activate.
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save & activate Custom endpoint' })).toBeEnabled();

    // Fetch the endpoint's models → pills appear and a model is picked.
    await modal.getByRole('button', { name: 'Fetch models' }).click();
    await expect(modal.getByText('2 model(s) found.')).toBeVisible();
    await modal.getByRole('button', { name: 'qwen2.5-coder-32b' }).click();

    // Type an API key but DON'T click "Save key" — the original usability bug
    // was that closing here silently dropped the typed key. Save & activate
    // must flush it.
    await modal.locator('input[placeholder="leave blank if the endpoint needs no auth"]').fill('pw-secret-token-123');
    await page.getByRole('button', { name: 'Save & activate Custom endpoint' }).click();
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toHaveCount(0);

    // The typed key was persisted to the aiKeys store despite never clicking "Save key".
    const storedKey = await page.evaluate(async () => {
      const db = await import('/src/ai/db.ts');
      return (await db.getKey('custom'))?.apiKey ?? null;
    });
    expect(storedKey).toBe('pw-secret-token-123');

    // The AI panel model picker is now a <select> populated with the fetched ids.
    const sel = page.locator('#ai-panel select');
    await expect(sel).toBeVisible();
    await expect(sel).toHaveValue('qwen2.5-coder-32b');
    const optionTexts = await sel.locator('option').allTextContents();
    expect(optionTexts).toContain('llama-3.3-70b-instruct');
  });

  test('Enable is gated on a connected key, except local', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();

    // OpenAI tab with no key → Enable is disabled.
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await expect(page.getByRole('button', { name: 'Enable OpenAI', exact: true })).toBeDisabled();

    // Local needs no key → Enable is always available.
    await page.locator('button:has-text("Local (WebGPU)")').dispatchEvent('click');
    await expect(page.getByRole('button', { name: 'Enable Local model', exact: true })).toBeEnabled();

    // Plant an OpenAI key, return to the OpenAI tab → Enable flips on.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('partwright');
        open.onsuccess = () => {
          const db = open.result;
          const txn = db.transaction('aiKeys', 'readwrite');
          txn.objectStore('aiKeys').put({
            provider: 'openai',
            apiKey: 'sk-test-planted-key-0000000000',
            createdAt: Date.now(),
            lastUsed: Date.now(),
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCostUsd: 0,
          });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
    });
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await expect(page.getByRole('button', { name: 'Enable OpenAI', exact: true })).toBeEnabled();
  });

  test('every hosted provider can load models from the key', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'AI Settings' });

    // Anthropic tab (default) exposes the loader.
    await expect(modal.locator('button:has-text("Load models from your key")')).toBeVisible();
    // OpenAI tab too (was Gemini-only before).
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await expect(modal.locator('button:has-text("Load models from your key")')).toBeVisible();
    // And Gemini.
    await page.locator('button:has-text("Gemini (cloud)")').dispatchEvent('click');
    await expect(modal.locator('button:has-text("Load models from your key")')).toBeVisible();
  });

  test('panel header model picker switches per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);

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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    // Header shows OpenAI's chosen model.
    await expect(page.locator('#ai-panel select').first()).toHaveValue('gpt-5-nano');
    // Enabling a provider now requires its key to be connected, so plant a
    // dummy Anthropic key directly in IndexedDB (the app's DB already exists
    // by now). Without it, "Enable Anthropic Claude" stays disabled.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('partwright');
        open.onsuccess = () => {
          const db = open.result;
          const txn = db.transaction('aiKeys', 'readwrite');
          txn.objectStore('aiKeys').put({
            provider: 'anthropic',
            apiKey: 'sk-ant-test-planted-key-0000000000',
            createdAt: Date.now(),
            lastUsed: Date.now(),
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCostUsd: 0,
          });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
    });
    // Flip the active provider to Anthropic via the tabbed settings modal:
    // view the Anthropic tab, then click its "Enable" button.
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    await page.locator('button:has-text("Anthropic (cloud)")').dispatchEvent('click');
    await page.getByRole('button', { name: 'Enable Anthropic Claude', exact: true }).dispatchEvent('click');
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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
    await openAiPanel(page);
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

  test('inline key form renders correctly per provider', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await openAiPanel(page);
    await page.locator('#ai-panel button[title^="AI settings"]').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    // Tabbed modal — the OpenAI tab shows its key form inline (no second
    // pop-up): placeholder input, console link, and Connect button together.
    await page.locator('button:has-text("OpenAI (cloud)")').dispatchEvent('click');
    await expect(page.locator('input[placeholder*="sk-proj"]')).toBeVisible();
    await expect(page.locator('a[href*="platform.openai.com"]')).toBeVisible();
    await expect(page.locator('button:has-text("Connect OpenAI")')).toBeVisible();
  });
});
