import { test, expect } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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

  test('Gemini validateKey tolerates a 503 and pings the models endpoint, not generateContent', async ({ page }) => {
    // Regression: validateKey used a generateContent ping on a hard-coded
    // model. When that model is overloaded Google answers 503 UNAVAILABLE
    // ("high demand") and a valid key looked rejected. Validation now hits
    // the lightweight models-list endpoint and treats 5xx as a transient
    // hiccup (non-blocking), so a busy backend never blocks a good key.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const gemini = await import('/src/ai/gemini.ts');
      const calls: string[] = [];
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown) => {
        calls.push(String(input));
        const body = JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } });
        return new Response(body, { status: 503 });
      };
      try {
        const result = await gemini.validateKey('AIza-test-key');
        return { result, calls };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(out.result).toBeNull();
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0]).toContain('/models');
    expect(out.calls[0]).not.toContain('generateContent');
  });

  test('Gemini validateKey reports a clearly invalid key', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const result = await page.evaluate(async () => {
      const gemini = await import('/src/ai/gemini.ts');
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async () => {
        const body = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } });
        return new Response(body, { status: 400 });
      };
      try {
        return await gemini.validateKey('bogus');
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(result).toBe('Invalid API key.');
  });

  test('Gemini routes thought parts to the thinking channel', async ({ page }) => {
    // Gemini 3 thinking models emit reasoning as `thought:true` text parts.
    // They must land in result.thinking (the collapsible box), NOT in the
    // answer text — and when thinking is enabled we must request them via
    // thinkingConfig so they come back flagged. Stub the SSE stream and
    // assert the split. (Thinking is opt-in now, so drive a non-off level.)
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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
          { apiKey: 'k', model: 'gemini-3.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: 'medium' },
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

  test('OpenAI reasoning models hit /v1/responses with max_output_tokens', async ({ page }) => {
    // Reasoning models run on the Responses API: gpt-5.5+ reject
    // reasoning_effort alongside function tools on /v1/chat/completions and
    // direct callers to /v1/responses. Stub the SSE stream, drive
    // streamTurn, and assert the endpoint + the Responses token spelling.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const sent = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      let url = '';
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init: { body?: string }) => {
        url = String(input);
        captured = String(init?.body ?? '');
        const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return { url, body: JSON.parse(captured) };
    });
    expect(sent.url).toContain('/v1/responses');
    expect(sent.body.max_output_tokens).toBeGreaterThan(0);
    expect(sent.body.max_completion_tokens).toBeUndefined();
    expect(sent.body.max_tokens).toBeUndefined();
    // System prompt rides in `instructions`; history converts to `input`.
    expect(sent.body.instructions).toBe('sys');
    expect(Array.isArray(sent.body.input)).toBe(true);
  });

  test('OpenAI non-reasoning models stay on /v1/chat/completions', async ({ page }) => {
    // Older / non-reasoning models (gpt-4o, gpt-4.1, legacy gpt-4 /
    // gpt-3.5-turbo) keep using Chat Completions — some exist only there, and
    // none hit the gpt-5.5 tools+reasoning restriction. Assert the endpoint +
    // the chat-shaped body (messages, max_completion_tokens).
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const sent = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      let url = '';
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init: { body?: string }) => {
        url = String(input);
        captured = String(init?.body ?? '');
        const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return { url, body: JSON.parse(captured) };
    });
    expect(sent.url).toContain('/v1/chat/completions');
    expect(sent.url).not.toContain('/v1/responses');
    expect(sent.body.max_completion_tokens).toBeGreaterThan(0);
    expect(sent.body.max_output_tokens).toBeUndefined();
    expect(sent.body.max_tokens).toBeUndefined();
    expect(Array.isArray(sent.body.messages)).toBe(true);
  });

  test('OpenAI (Responses) repairs a dangling tool_call left by an interrupted turn', async ({ page }) => {
    // Regression: a turn that ends right after the model emits tool calls
    // (Stop / stall / spend cap before results post) leaves a dangling
    // function_call with no function_call_output. The Responses API 400s on
    // the next send ("No tool output found for function call …") unless we
    // inject a synthetic output, the way the Anthropic builder already does.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const sentBody = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      let captured = '';
      const origFetch = window.fetch;
      // @ts-expect-error test stub
      window.fetch = async (_input: unknown, init: { body?: string }) => {
        captured = String(init?.body ?? '');
        const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
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
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history: history as any, tools: [] });
      } finally {
        window.fetch = origFetch;
      }
      return captured;
    });
    const sent = JSON.parse(sentBody);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = sent.input as any[];
    const outputs = items.filter(it => it.type === 'function_call_output' && it.call_id === 'call_DANGLING');
    expect(outputs).toHaveLength(1);
    // The synthetic output must sit after the function_call and before the
    // user's feedback, so the call→output invariant holds.
    const callIdx = items.findIndex(it => it.type === 'function_call' && it.call_id === 'call_DANGLING');
    const outputIdx = items.findIndex(it => it.type === 'function_call_output' && it.call_id === 'call_DANGLING');
    const userIdx = items.findIndex(it => it.type === 'message' && it.role === 'user'
      && Array.isArray(it.content) && it.content.some((c: { text?: string }) => c.text?.includes('add a handle')));
    expect(callIdx).toBeLessThan(outputIdx);
    expect(outputIdx).toBeLessThan(userIdx);
  });

  test('OpenAI (Chat Completions) repairs a dangling tool_call left by an interrupted turn', async ({ page }) => {
    // Same invariant on the non-reasoning path: an assistant tool_calls
    // message with no matching `tool` reply 400s ("tool_call_ids did not have
    // response messages") unless we inject a synthetic tool result.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
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
          { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'call_DANGLING', name: 'runIsolated', input: {} }], createdAt: 0, seq: 0 },
          { id: 'u1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'looks good, add a handle' }], createdAt: 0, seq: 1 },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history: history as any, tools: [] });
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
    const assistantIdx = msgs.findIndex(m => Array.isArray(m.tool_calls));
    const toolIdx = msgs.findIndex(m => m.tool_call_id === 'call_DANGLING');
    const userIdx = msgs.findIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('add a handle'));
    expect(assistantIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(userIdx);
  });

  test('Anthropic sends the thinking param with budget when enabled, omits it when off', async ({ page }) => {
    // Off must reproduce the pre-feature request exactly (no `thinking`
    // field); a non-off level enables extended thinking with budget_tokens
    // and floats max_tokens above the budget (the API requires >).
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const a = await import('/src/ai/anthropic.ts');
      const bodies: Record<string, { thinking?: unknown; max_tokens?: number }> = {};
      const origFetch = window.fetch;
      // A minimal but complete Anthropic SSE stream so finalMessage()
      // resolves cleanly. The body is captured before any parsing, so the
      // assertion holds regardless.
      const SSE = [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n');
      async function run(level: string, key: string) {
        a.resetClient();
        // @ts-expect-error test stub
        window.fetch = async (_input: unknown, init: { body?: string }) => {
          bodies[key] = JSON.parse(String(init?.body ?? '{}'));
          return new Response(new Blob([SSE]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        try {
          await a.streamTurn({
            apiKey: 'k', model: 'claude-haiku-4-5', systemPrompt: 'sys', systemSuffix: '',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            apiMessages: [{ role: 'user', content: 'hi' }] as any, tools: [], thinking: level as any,
          });
        } catch { /* body already captured; parsing differences are irrelevant here */ }
      }
      try { await run('off', 'off'); await run('medium', 'medium'); } finally { window.fetch = origFetch; }
      return bodies;
    });
    expect(out.off.thinking).toBeUndefined();
    expect(out.medium.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(out.medium.max_tokens as number).toBeGreaterThan(8192);
  });

  test('Anthropic replays signed thinking blocks before tool_use during tool use', async ({ page }) => {
    // The riskiest invariant: when thinking is on, an assistant turn that
    // contains a tool_use must lead with its signed thinking block, or the
    // next request 400s. buildApiMessages is a pure function, so assert the
    // ordering directly. With replay off, no thinking block leaks in.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const a = await import('/src/ai/anthropic.ts');
      const history = [
        {
          id: 'a1', sessionId: 's', role: 'assistant',
          blocks: [{ type: 'text', text: 'let me check' }],
          toolCalls: [{ id: 'tu_1', name: 'getGeometryData', input: {} }],
          thinkingBlocks: [{ type: 'thinking', thinking: 'I should inspect the mesh first.', signature: 'SIG_1' }],
          createdAt: 0, seq: 0,
        },
        { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'tu_1', content: '{"ok":true}' }], createdAt: 0, seq: 1 },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withReplay = a.buildApiMessages(history as any, { replayThinking: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const without = a.buildApiMessages(history as any, { replayThinking: false });
      return { withReplay, without };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst = out.withReplay.find((m: any) => m.role === 'assistant');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = asst.content.map((b: any) => b.type);
    expect(asst.content[0].type).toBe('thinking');
    expect(asst.content[0].signature).toBe('SIG_1');
    expect(asst.content[0].thinking).toContain('inspect the mesh');
    expect(types.indexOf('thinking')).toBeLessThan(types.indexOf('tool_use'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst2 = out.without.find((m: any) => m.role === 'assistant');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(asst2.content.some((b: any) => b.type === 'thinking')).toBe(false);
  });

  test('Gemini maps the thinking level to thinkingConfig', async ({ page }) => {
    // off → reasoning hidden, no forced budget (so Pro models don't 400 on
    // budget 0). A non-off level surfaces thoughts with a positive budget.
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const gemini = await import('/src/ai/gemini.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodies: Record<string, any> = {};
      const origFetch = window.fetch;
      async function run(level: string, key: string) {
        // @ts-expect-error test stub
        window.fetch = async (_input: unknown, init: { body?: string }) => {
          bodies[key] = JSON.parse(String(init?.body ?? '{}'));
          const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
          return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await gemini.streamTurn({ apiKey: 'k', model: 'gemini-3.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: level as any });
      }
      try { await run('off', 'off'); await run('high', 'high'); } finally { window.fetch = origFetch; }
      return bodies;
    });
    expect(out.off.generationConfig.thinkingConfig.includeThoughts).toBe(false);
    expect(out.off.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
    expect(out.high.generationConfig.thinkingConfig.includeThoughts).toBe(true);
    expect(out.high.generationConfig.thinkingConfig.thinkingBudget).toBeGreaterThan(0);
  });

  test('OpenAI sends reasoning.effort only for reasoning models + non-off levels', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const openai = await import('/src/ai/openai.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodies: Record<string, any> = {};
      const origFetch = window.fetch;
      async function run(model: string, level: string, key: string) {
        // @ts-expect-error test stub
        window.fetch = async (_input: unknown, init: { body?: string }) => {
          bodies[key] = JSON.parse(String(init?.body ?? '{}'));
          const body = 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
          return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await openai.streamTurn({ apiKey: 'k', model, systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: level as any });
      }
      try {
        await run('gpt-5.5', 'high', 'reasoningHigh');
        await run('gpt-5.5', 'off', 'reasoningOff');
        await run('gpt-4o', 'high', 'chatHigh');
      } finally { window.fetch = origFetch; }
      return bodies;
    });
    // Reasoning model on the Responses path: `reasoning.effort` set when on,
    // omitted when off.
    expect(out.reasoningHigh.reasoning.effort).toBe('high');
    expect(out.reasoningOff.reasoning).toBeUndefined();
    // Non-reasoning model on the Chat Completions path: never carries a
    // reasoning request in either spelling, even at thinking=high.
    expect(out.chatHigh.reasoning).toBeUndefined();
    expect(out.chatHigh.reasoning_effort).toBeUndefined();
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
    // four, then walk each hosted tab and confirm its Connect button.
    const tabLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').trim())
    );
    expect(tabLabels.some(l => /^Anthropic \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^OpenAI \(cloud\)/.test(l))).toBe(true);
    expect(tabLabels.some(l => /^Gemini \(cloud\)/.test(l))).toBe(true);
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
    await expect(page.locator('button:has-text("Enable OpenAI")')).toBeDisabled();

    // Local needs no key → Enable is always available.
    await page.locator('button:has-text("Local (WebGPU)")').dispatchEvent('click');
    await expect(page.locator('button:has-text("Enable Local model")')).toBeEnabled();

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
    await expect(page.locator('button:has-text("Enable OpenAI")')).toBeEnabled();
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

test.describe('Capability suffix', () => {
  // Regression: when the user flipped the Paint toggle ON mid-conversation,
  // the per-turn system suffix merely dropped its "you cannot paint"
  // restriction line — it never positively asserted that paint was now
  // available. The model kept claiming paint was off on the first request
  // after enabling, only believing the user once told a second time. The
  // suffix now declares each capability ON/OFF explicitly so a freshly
  // enabled tool is unambiguous on the very next turn.
  test('positively declares paint ON/OFF based on the toggle', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const { offSuffix, onSuffix } = await page.evaluate(async () => {
      const sp = await import('/src/ai/systemPrompt.ts');
      const settings = await import('/src/ai/settings.ts');
      const base = settings.loadSettings();
      const off = settings.setToggles(base, { scope: { paintFaces: false } }).toggles;
      const on = settings.setToggles(base, { scope: { paintFaces: true } }).toggles;
      return { offSuffix: sp.toggleSuffix(off), onSuffix: sp.toggleSuffix(on) };
    });

    // OFF: explicit OFF in the capability list + a behavioural reminder.
    expect(offSuffix).toContain('Paint / color regions: OFF');
    expect(offSuffix).toContain('Paint is OFF');

    // ON: explicit ON, and no lingering "off" signal for paint that the
    // model could anchor on.
    expect(onSuffix).toContain('Paint / color regions: ON');
    expect(onSuffix).not.toContain('Paint / color regions: OFF');
    expect(onSuffix).not.toContain('Paint is OFF');
    // The override directive that tells the model the list beats earlier turns.
    expect(onSuffix).toContain('OVERRIDES anything said earlier');
  });
});
