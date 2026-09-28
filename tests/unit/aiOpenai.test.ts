// Unit tests for the OpenAI request builder / SSE parsing (src/ai/openai.ts).
// Pure logic driven with a stubbed global `fetch` — Node 22 ships native
// fetch/Response/Blob/ReadableStream, so no browser is needed. Moved out of
// tests/ai-providers.spec.ts, which used to pay a ~2s page boot per test just
// to reach these request-builder assertions.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as openai from '../../src/ai/openai';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI endpoint routing', () => {
  test('reasoning models hit /v1/responses with max_output_tokens', async () => {
    // Reasoning models run on the Responses API: gpt-5.5+ reject
    // reasoning_effort alongside function tools on /v1/chat/completions and
    // direct callers to /v1/responses. Stub the SSE stream, drive
    // streamTurn, and assert the endpoint + the Responses token spelling.
    let url = '';
    let captured = '';
    vi.stubGlobal('fetch', async (input: unknown, init: { body?: string }) => {
      url = String(input);
      captured = String(init?.body ?? '');
      const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools: [] });

    const sentBody = JSON.parse(captured);
    expect(url).toContain('/v1/responses');
    expect(sentBody.max_output_tokens).toBeGreaterThan(0);
    expect(sentBody.max_completion_tokens).toBeUndefined();
    expect(sentBody.max_tokens).toBeUndefined();
    // System prompt rides in `instructions`; history converts to `input`.
    expect(sentBody.instructions).toBe('sys');
    expect(Array.isArray(sentBody.input)).toBe(true);
  });

  test('non-reasoning models stay on /v1/chat/completions', async () => {
    // Older / non-reasoning models (gpt-4o, gpt-4.1, legacy gpt-4 /
    // gpt-3.5-turbo) keep using Chat Completions — some exist only there, and
    // none hit the gpt-5.5 tools+reasoning restriction. Assert the endpoint +
    // the chat-shaped body (messages, max_completion_tokens).
    let url = '';
    let captured = '';
    vi.stubGlobal('fetch', async (input: unknown, init: { body?: string }) => {
      url = String(input);
      captured = String(init?.body ?? '');
      const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools: [] });

    const sentBody = JSON.parse(captured);
    expect(url).toContain('/v1/chat/completions');
    expect(url).not.toContain('/v1/responses');
    expect(sentBody.max_completion_tokens).toBeGreaterThan(0);
    expect(sentBody.max_output_tokens).toBeUndefined();
    expect(sentBody.max_tokens).toBeUndefined();
    expect(Array.isArray(sentBody.messages)).toBe(true);
  });
});

describe('OpenAI dangling tool_call repair', () => {
  test('(Responses) repairs a dangling tool_call left by an interrupted turn', async () => {
    // Regression: a turn that ends right after the model emits tool calls
    // (Stop / stall / spend cap before results post) leaves a dangling
    // function_call with no function_call_output. The Responses API 400s on
    // the next send ("No tool output found for function call …") unless we
    // inject a synthetic output, the way the Anthropic builder already does.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      // Assistant emitted a tool call...
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'call_DANGLING', name: 'runIsolated', input: {} }], createdAt: 0, seq: 0 },
      // ...but the turn ended; the user just typed feedback (no toolResults).
      { id: 'u1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'looks good, add a handle' }], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
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

  test('(Chat Completions) repairs a dangling tool_call left by an interrupted turn', async () => {
    // Same invariant on the non-reasoning path: an assistant tool_calls
    // message with no matching `tool` reply 400s ("tool_call_ids did not have
    // response messages") unless we inject a synthetic tool result.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [{ id: 'call_DANGLING', name: 'runIsolated', input: {} }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'looks good, add a handle' }], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
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
});

describe('OpenAI orphaned tool_result compaction cleanup', () => {
  test('(Responses) drops an orphaned function_call_output left behind by compaction', async () => {
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 's0', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '[compacted summary]' }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'call_GONE', content: 'ok' }], createdAt: 0, seq: 1 },
      { id: 'u2', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'now add a handle' }], createdAt: 0, seq: 2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = sent.input as any[];
    expect(items.some(it => it.type === 'function_call_output' && it.call_id === 'call_GONE')).toBe(false);
  });

  test('(Chat Completions) drops an orphaned tool message left behind by compaction', async () => {
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 's0', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '[compacted summary]' }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'call_GONE', content: 'ok' }], createdAt: 0, seq: 1 },
      { id: 'u2', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'now add a handle' }], createdAt: 0, seq: 2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs = sent.messages as any[];
    expect(msgs.some(m => m.role === 'tool' && m.tool_call_id === 'call_GONE')).toBe(false);
  });
});

describe('OpenAI tool-result image contiguity (#914/#913)', () => {
  test('(Chat Completions) keeps tool result messages contiguous when an earlier result carries an image', async () => {
    // Regression for #914 (repro from #913): a multi-tool turn where an earlier
    // tool result (renderViews) carries an image. OpenAI's `tool` role can't
    // hold an image, so it rides on a following `user` message — and if that
    // message is interleaved between the `tool` messages, a strict backend (an
    // OpenAI-compatible gateway proxying to Claude — the `toolu_`-id case) sees
    // the later tool_use as no longer "immediately after" its result and 400s
    // ("tool_use ids were found without tool_result blocks immediately after").
    // The persisted history is CLEAN (results present + adjacent), so the
    // Repair button correctly finds nothing — the builder is the bug. All
    // `tool` messages must stay contiguous, with the image `user` message after.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [
        { id: 'toolu_RENDER', name: 'renderViews', input: {} },
        { id: 'toolu_QUERY', name: 'query', input: {} },
      ], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [
        { toolUseId: 'toolu_RENDER', content: 'rendered', image: { data: 'AAAA', mediaType: 'image/png', label: 'iso' } },
        { toolUseId: 'toolu_QUERY', content: '{"volume":10}' },
      ], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs = sent.messages as any[];
    const renderIdx = msgs.findIndex(m => m.role === 'tool' && m.tool_call_id === 'toolu_RENDER');
    const queryIdx = msgs.findIndex(m => m.role === 'tool' && m.tool_call_id === 'toolu_QUERY');
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    expect(queryIdx).toBeGreaterThanOrEqual(0);
    // The two tool results are adjacent — nothing wedged between them.
    expect(queryIdx).toBe(renderIdx + 1);
    // The image rides on a user message that comes AFTER both tool results.
    const imageIdx = msgs.findIndex(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'image_url'),
    );
    expect(imageIdx).toBeGreaterThan(queryIdx);
  });

  test('(Responses) keeps function_call_output items contiguous when an earlier result carries an image', async () => {
    // The Responses-API twin of the contiguity fix: function_call_output takes
    // a string `output`, so a rendered result's image rides on a following
    // user message; it must not split the outputs.
    let captured = '';
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      captured = String(init?.body ?? '');
      const body = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const history = [
      { id: 'a1', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [
        { id: 'toolu_RENDER', name: 'renderViews', input: {} },
        { id: 'toolu_QUERY', name: 'query', input: {} },
      ], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [
        { toolUseId: 'toolu_RENDER', content: 'rendered', image: { data: 'AAAA', mediaType: 'image/png', label: 'iso' } },
        { toolUseId: 'toolu_QUERY', content: '{"volume":10}' },
      ], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    await openai.streamTurn({ apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history, tools: [] });

    const sent = JSON.parse(captured);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = sent.input as any[];
    const renderIdx = items.findIndex(it => it.type === 'function_call_output' && it.call_id === 'toolu_RENDER');
    const queryIdx = items.findIndex(it => it.type === 'function_call_output' && it.call_id === 'toolu_QUERY');
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    expect(queryIdx).toBe(renderIdx + 1);
    const imageIdx = items.findIndex(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      it => it.type === 'message' && it.role === 'user' && Array.isArray(it.content) && it.content.some((b: any) => b.type === 'input_image'),
    );
    expect(imageIdx).toBeGreaterThan(queryIdx);
  });
});

describe('OpenAI Chat Completions tool-call streaming', () => {
  test('keeps tool calls distinct when an OpenAI-compatible server omits tool_calls[].index', async () => {
    // llama.cpp/vLLM/Ollama OpenAI-compat shims frequently stream tool calls
    // without the numeric `index`. Keying buffers on `index ?? 0` collapsed
    // every call into bucket 0, concatenating their argument fragments into
    // invalid JSON so all calls after the first were silently dropped. With the
    // id-based fallback both calls must survive with correctly-parsed args.
    // Two distinct tool calls, each delivered whole, with NO `index` field.
    const body = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_A","function":{"name":"renderView","arguments":"{\\"view\\":\\"front\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_B","function":{"name":"query","arguments":"{\\"q\\":\\"volume\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    vi.stubGlobal('fetch', async () => new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const r = await openai.streamTurn({ apiKey: 'k', model: 'gpt-4o', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools: [] });
    expect(r.toolCalls.map(c => c.id)).toEqual(['call_A', 'call_B']);
    expect(r.toolCalls.map(c => c.name)).toEqual(['renderView', 'query']);
    expect(r.toolCalls.map(c => c.input)).toEqual([{ view: 'front' }, { q: 'volume' }]);
  });
});

describe('OpenAI thinking / reasoning effort', () => {
  test('sends reasoning.effort only for reasoning models + non-off levels', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodies: Record<string, any> = {};
    async function run(model: string, level: string, key: string) {
      vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
        bodies[key] = JSON.parse(String(init?.body ?? '{}'));
        const body = 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await openai.streamTurn({ apiKey: 'k', model, systemPrompt: 'sys', systemSuffix: '', history: [] as any, tools: [], thinking: level as any });
    }
    await run('gpt-5.5', 'high', 'reasoningHigh');
    await run('gpt-5.5', 'off', 'reasoningOff');
    await run('gpt-4o', 'high', 'chatHigh');

    // Reasoning model on the Responses path: `reasoning.effort` set when on,
    // omitted when off.
    expect(bodies.reasoningHigh.reasoning.effort).toBe('high');
    expect(bodies.reasoningOff.reasoning).toBeUndefined();
    // Non-reasoning model on the Chat Completions path: never carries a
    // reasoning request in either spelling, even at thinking=high.
    expect(bodies.chatHigh.reasoning).toBeUndefined();
    expect(bodies.chatHigh.reasoning_effort).toBeUndefined();
  });
});
