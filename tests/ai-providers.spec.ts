import { test, expect } from 'playwright/test';

// Regression coverage for the multi-provider extension to the in-app
// chat. The base in-browser AI surface (Anthropic + Local) has its own
// smoke tests; these focus on the hosted-provider additions (OpenAI,
// Gemini), the Review modal, and the Diagnostics view.

test.describe('Multi-provider AI', () => {
  test('SSE reader handles CRLF event framing (Gemini)', async ({ page }) => {
    // Regression: Gemini frames streamGenerateContent SSE events with
    // CRLF (`\r\n\r\n`). The reader used to split only on `\n\n`, so it
    // never found a boundary and dropped the whole stream — the Gemini
    // turn "exited without a final message" with 0 tokens. Feed the
    // reader a CRLF-framed body and confirm it yields both events.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const events = await page.evaluate(async () => {
      const mod = await import('/src/ai/sse.ts');
      const body = 'data: {"x":1}\r\n\r\ndata: {"y":2}\r\n\r\ndata: [DONE]\r\n\r\n';
      const res = new Response(new Blob([body]), { headers: { 'Content-Type': 'text/event-stream' } });
      const out: string[] = [];
      for await (const e of mod.readSseStream(res)) out.push(e);
      return out;
    });
    expect(events).toEqual(['{"x":1}', '{"y":2}', '[DONE]']);
  });

  test('SSE reader handles CRLF split across network chunks', async ({ page }) => {
    // The real-world bug: a `\r\n` straddles two chunks (one ends with
    // `\r`, the next starts with `\n`). A per-chunk `\r\n`→`\n` replace
    // misses that, dropping events — which manifested as truncated
    // assistant text and spurious stalls. Feed deliberately awkward
    // chunk splits and confirm every event still parses.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const events = await page.evaluate(async () => {
      const mod = await import('/src/ai/sse.ts');
      // Full stream is three CRLF-separated events:
      //   data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\ndata: {"c":3}\r\n\r\n
      // but the network chunk boundaries deliberately fall mid-CRLF (a
      // chunk ends with '\r', the next starts with '\n'), the case a
      // per-chunk `\r\n`→`\n` replace mishandles.
      const chunks = [
        'data: {"a":1}\r\n\r',
        '\ndata: {"b":2}\r',
        '\n\r\ndata: {"c":3}\r\n\r\n',
      ];
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
      });
      const res = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      const out: string[] = [];
      for await (const e of mod.readSseStream(res)) out.push(e);
      return out;
    });
    expect(events).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  test('Gemini replays thoughtSignature on functionCall parts', async ({ page }) => {
    // Regression: Gemini 3 attaches an opaque thought_signature to each
    // functionCall part and 400s if it isn't echoed back on the next
    // request. Drive gemini.streamTurn with a history containing a prior
    // tool call that carries a signature, stub fetch to capture the
    // outgoing body, and assert the functionCall part replays the sig.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const sentBody = await page.evaluate(async () => {
      const gemini = await import('/src/ai/gemini.ts');
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (_input: unknown, init: { body?: string }) => {
        captured = String(init?.body ?? '');
        const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        const history = [
          { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'gemini_call_0', name: 'getSessionContext', input: {}, thoughtSignature: 'SIG_ABC' }], createdAt: 0, seq: 0 },
          { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'gemini_call_0', content: '{"ok":true}' }], createdAt: 0, seq: 1 },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await gemini.streamTurn({ apiKey: 'k', model: 'gemini-2.5-flash', systemPrompt: 'sys', systemSuffix: '', history: history as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return captured;
    });
    const parsed = JSON.parse(sentBody);
    const modelTurn = parsed.contents.find((c: { role: string }) => c.role === 'model');
    const fcPart = modelTurn.parts.find((p: { functionCall?: unknown }) => p.functionCall);
    expect(fcPart.thoughtSignature).toBe('SIG_ABC');
  });

  test('Gemini routes thought parts to the thinking channel', async ({ page }) => {
    // Gemini 3 thinking models emit reasoning as `thought:true` text parts.
    // They must land in result.thinking (the collapsible box), NOT in the
    // answer text — and we must request them via thinkingConfig so they
    // come back flagged. Stub the SSE stream and assert the split.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const out = await page.evaluate(async () => {
      const gemini = await import('/src/ai/gemini.ts');
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (_input: unknown, init: { body?: string }) => {
        captured = String(init?.body ?? '');
        const frames = [
          'data: {"candidates":[{"content":{"parts":[{"text":"Reasoning: winding order must be CCW.","thought":true}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"Done — created the sphere."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":5}}',
        ];
        const body = frames.join('\r\n\r\n') + '\r\n\r\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      const thinkingDeltas: string[] = [];
      const textDeltas: string[] = [];
      try {
        const result = await gemini.streamTurn(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { apiKey: 'k', model: 'gemini-3.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] },
          { onThinking: d => thinkingDeltas.push(d), onText: d => textDeltas.push(d) },
        );
        return { thinking: result.thinking ?? '', text: result.text, captured, thinkingDeltas, textDeltas };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(out.thinking).toContain('winding order');
    expect(out.text).toBe('Done — created the sphere.');
    expect(out.text).not.toContain('winding order');
    expect(out.thinkingDeltas.join('')).toContain('winding order');
    expect(out.textDeltas.join('')).toBe('Done — created the sphere.');
    // The request must opt into thought summaries, else nothing to box.
    const sent = JSON.parse(out.captured);
    expect(sent.generationConfig.thinkingConfig.includeThoughts).toBe(true);
  });

  test('thinking block renders as a collapsible box, separate from the answer', async ({ page }) => {
    // A persisted assistant turn with a thinking block should render the
    // reasoning in a collapsed expand/contract box (hidden until clicked),
    // with the answer in its own bubble.
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.waitForSelector('#ai-panel');
    // Bare /editor auto-restores a session (id in the URL, stable across
    // reload), so the chat pins to that bucket — seed there, not global.
    await page.evaluate(async () => {
      const db = await import('/src/ai/db.ts');
      const sm = await import('/src/storage/sessionManager.ts');
      const sid = sm.getState().session?.id ?? db.GLOBAL_CHAT_BUCKET;
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
    });
    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
    const box = page.locator('#ai-panel details').filter({ hasText: '🧠 Thinking' });
    await expect(box).toBeVisible();
    // The answer is in its own bubble, visible without expanding anything.
    await expect(page.locator('#ai-panel').getByText('Done — created the sphere.')).toBeVisible();
    // Reasoning is hidden (collapsed) until the box is expanded.
    await expect(box.locator('pre')).toBeHidden();
    await box.locator('summary').dispatchEvent('click');
    await expect(box.locator('pre')).toBeVisible();
    await expect(box.locator('pre')).toContainText('winding order must be CCW');
  });

  test('OpenAI sends max_completion_tokens, not the rejected max_tokens', async ({ page }) => {
    // Regression: the gpt-5 family and o-series 400 on `max_tokens`
    // ("Unsupported parameter… Use 'max_completion_tokens' instead"). Stub
    // the SSE stream, drive streamTurn, and assert the outgoing body uses
    // the new spelling and drops the old one entirely.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const sentBody = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (_input: unknown, init: { body?: string }) => {
        captured = String(init?.body ?? '');
        const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-5-mini', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return captured;
    });
    const sent = JSON.parse(sentBody);
    expect(sent.max_completion_tokens).toBeGreaterThan(0);
    expect(sent.max_tokens).toBeUndefined();
  });

  test('OpenAI repairs a dangling tool_call left by an interrupted turn', async ({ page }) => {
    // Regression: a turn that ends right after the model emits tool calls
    // (Stop / stall / spend cap before results post) leaves an assistant
    // tool_calls message with no tool result. OpenAI 400s on the next send
    // ("tool_call_ids did not have response messages") unless we inject a
    // synthetic result, the way the Anthropic builder already does.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    const sentBody = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (_input: unknown, init: { body?: string }) => {
        captured = String(init?.body ?? '');
        const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        const history = [
          // Assistant emitted a tool call...
          { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'call_DANGLING', name: 'runIsolated', input: {} }], createdAt: 0, seq: 0 },
          // ...but the turn ended; the user just typed feedback (no toolResults).
          { id: 'u1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'looks good, add a handle' }], createdAt: 0, seq: 1 },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-5-mini', systemPrompt: 'sys', systemSuffix: '', history: history as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return captured;
    });
    const sent = JSON.parse(sentBody);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs = sent.messages as any[];
    const toolMsgs = msgs.filter(m => m.role === 'tool' && m.tool_call_id === 'call_DANGLING');
    expect(toolMsgs).toHaveLength(1);
    // The synthetic result must sit after the assistant tool_calls message
    // and before the user's feedback, so the invariant holds.
    const assistantIdx = msgs.findIndex(m => Array.isArray(m.tool_calls));
    const toolIdx = msgs.findIndex(m => m.tool_call_id === 'call_DANGLING');
    const userIdx = msgs.findIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('add a handle'));
    expect(assistantIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(userIdx);
  });

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
