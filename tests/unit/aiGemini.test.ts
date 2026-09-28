// Unit tests for the Gemini request builder / SSE parsing (src/ai/gemini.ts).
// Pure logic driven with a stubbed global `fetch` — Node 22 ships native
// fetch/Response/Blob/ReadableStream, so no browser is needed. Moved out of
// tests/ai-providers.spec.ts, which used to pay a ~2s page boot per test just
// to reach these request-builder assertions.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as gemini from '../../src/ai/gemini';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gemini streamTurn', () => {
  test('replays thoughtSignature on functionCall parts', async () => {
    // Regression: Gemini 3 attaches an opaque thought_signature to each
    // functionCall part and 400s if it isn't echoed back on the next
    // request. Drive gemini.streamTurn with a history containing a prior
    // tool call that carries a signature, stub fetch to capture the
    // outgoing body, and assert the functionCall part replays the sig.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'gemini_call_0', name: 'getSessionContext', input: {}, thoughtSignature: 'SIG_ABC' }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'gemini_call_0', content: '{"ok":true}' }], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await gemini.streamTurn({ apiKey: 'k', model: 'gemini-2.5-flash', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const parsed = JSON.parse(captured);
    const modelTurn = parsed.contents.find((c: { role: string }) => c.role === 'model');
    const fcPart = modelTurn.parts.find((p: { functionCall?: unknown }) => p.functionCall);
    expect(fcPart.thoughtSignature).toBe('SIG_ABC');
  });

  test('captures a text turn thoughtSignature from a trailing empty-text part', async () => {
    // Regression for the "Gemini stalls after thinking" bug: Gemini 3 streams a
    // text response's thought signature on a trailing part whose text is empty.
    // The old parser skipped empty-text parts (they matched neither the text
    // nor the functionCall branch), dropping the signature — which silently
    // degrades the model into a premature, tiny end_turn. The signature must be
    // captured and surfaced as result.textThoughtSignature for a pure-text turn.
    vi.stubGlobal('fetch', async () => {
      const frames = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Looks good — done."}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":"SIG_TEXT"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}',
      ];
      const body = frames.join('\r\n\r\n') + '\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await gemini.streamTurn({ apiKey: 'k', model: 'gemini-flash-latest', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] });
    expect(result.text).toBe('Looks good — done.');
    expect((result as { textThoughtSignature?: string }).textThoughtSignature).toBe('SIG_TEXT');
    expect(result.toolCalls.length).toBe(0);
  });

  test('replays an answer-text thoughtSignature on the text part', async () => {
    // The captured text-turn signature (above) rides the persisted text block
    // and must replay on the text part of the next request, so a resumed
    // Gemini conversation keeps its reasoning thread.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: 'Planning the box.', thoughtSignature: 'SIG_TEXT' }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'keep going' }], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await gemini.streamTurn({ apiKey: 'k', model: 'gemini-flash-latest', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const parsed = JSON.parse(captured);
    const modelTurn = parsed.contents.find((c: { role: string }) => c.role === 'model');
    const textPart = modelTurn.parts.find((p: { text?: string }) => typeof p.text === 'string');
    expect(textPart.text).toBe('Planning the box.');
    expect(textPart.thoughtSignature).toBe('SIG_TEXT');
  });

  test('strips exclusiveMinimum/exclusiveMaximum from tool schemas', async () => {
    // Regression: Gemini's OpenAPI subset only knows minimum/maximum, so a tool
    // param carrying `exclusiveMinimum` (e.g. scaleModel's sx/sy/sz) 400s with
    // `Unknown name "exclusiveMinimum" … Cannot find field`. The sanitizer must
    // drop those keywords (at any nesting depth) before the request goes out.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const tools = [{
      name: 'scaleModel',
      description: 'Resize.',
      input_schema: {
        type: 'object',
        properties: {
          sx: { type: 'number', description: 'X factor.', exclusiveMinimum: 0 },
          nested: {
            type: 'array',
            items: { type: 'number', exclusiveMaximum: 10 },
          },
        },
        required: ['sx'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any;
    await gemini.streamTurn({ apiKey: 'k', model: 'gemini-2.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools });

    expect(captured).not.toContain('exclusiveMinimum');
    expect(captured).not.toContain('exclusiveMaximum');
    // The surrounding schema must survive — the param itself is still present.
    const parsed = JSON.parse(captured);
    const decl = parsed.tools[0].functionDeclarations[0];
    expect(decl.parameters.properties.sx.type).toBe('number');
    expect(decl.parameters.properties.nested.items.type).toBe('number');
  });

  test('backfills a functionCall thoughtSignature delivered in a separate chunk', async () => {
    // Hardening for the documented 400 ("missing thought_signature after
    // multiple tool uses"): when the signature streams in a chunk separate from
    // the functionCall part it belongs to, it must still attach to the call so
    // the next request doesn't 400.
    vi.stubGlobal('fetch', async () => {
      const frames = [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"getSessionContext","args":{}}}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":"SIG_FC"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}',
      ];
      const body = frames.join('\r\n\r\n') + '\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await gemini.streamTurn({ apiKey: 'k', model: 'gemini-flash-latest', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [] });
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe('getSessionContext');
    expect(result.toolCalls[0]?.thoughtSignature).toBe('SIG_FC');
  });

  test('routes thought parts to the thinking channel', async () => {
    // Gemini 3 thinking models emit reasoning as `thought:true` text parts.
    // They must land in result.thinking (the collapsible box), NOT in the
    // answer text — and when thinking is enabled we must request them via
    // thinkingConfig so they come back flagged. Stub the SSE stream and
    // assert the split. (Thinking is opt-in now, so drive a non-off level.)
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const frames = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Reasoning: winding order must be CCW.","thought":true}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"Done — created the sphere."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":5}}',
      ];
      const body = frames.join('\r\n\r\n') + '\r\n\r\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const thinkingDeltas: string[] = [];
    const textDeltas: string[] = [];
    const result = await gemini.streamTurn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { apiKey: 'k', model: 'gemini-3.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: 'medium' },
      { onThinking: d => thinkingDeltas.push(d), onText: d => textDeltas.push(d) },
    );
    expect(result.thinking ?? '').toContain('winding order');
    expect(result.text).toBe('Done — created the sphere.');
    expect(result.text).not.toContain('winding order');
    expect(thinkingDeltas.join('')).toContain('winding order');
    expect(textDeltas.join('')).toBe('Done — created the sphere.');
    // The request must opt into thought summaries, else nothing to box.
    const sent = JSON.parse(captured);
    expect(sent.generationConfig.thinkingConfig.includeThoughts).toBe(true);
  });

  test('maps the thinking level to thinkingConfig', async () => {
    // off → reasoning hidden, no forced budget (so Pro models don't 400 on
    // budget 0). A non-off level surfaces thoughts with a positive budget.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodies: Record<string, any> = {};
    async function run(level: string, key: string) {
      vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
        bodies[key] = JSON.parse(String(init?.body ?? '{}'));
        const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await gemini.streamTurn({ apiKey: 'k', model: 'gemini-3.5-flash', systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: level as any });
    }
    await run('off', 'off');
    await run('high', 'high');
    expect(bodies.off.generationConfig.thinkingConfig.includeThoughts).toBe(false);
    expect(bodies.off.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
    expect(bodies.high.generationConfig.thinkingConfig.includeThoughts).toBe(true);
    expect(bodies.high.generationConfig.thinkingConfig.thinkingBudget).toBeGreaterThan(0);
  });
});

describe('Gemini validateKey', () => {
  test('tolerates a 503 and pings the models endpoint, not generateContent', async () => {
    // Regression: validateKey used a generateContent ping on a hard-coded
    // model. When that model is overloaded Google answers 503 UNAVAILABLE
    // ("high demand") and a valid key looked rejected. Validation now hits
    // the lightweight models-list endpoint and treats 5xx as a transient
    // hiccup (non-blocking), so a busy backend never blocks a good key.
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      calls.push(String(input));
      const body = JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } });
      return new Response(body, { status: 503 });
    });
    const result = await gemini.validateKey('AIza-test-key');
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/models');
    expect(calls[0]).not.toContain('generateContent');
  });

  test('reports a clearly invalid key', async () => {
    vi.stubGlobal('fetch', async () => {
      const body = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } });
      return new Response(body, { status: 400 });
    });
    const result = await gemini.validateKey('bogus');
    expect(result).toBe('Invalid API key.');
  });
});
