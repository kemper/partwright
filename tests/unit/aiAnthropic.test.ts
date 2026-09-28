// Unit tests for the Anthropic request builder / thinking config
// (src/ai/anthropic.ts). Pure logic driven with a stubbed global `fetch` —
// Node 22 ships native fetch/Response/Blob, so no browser is needed. Moved
// out of tests/ai-providers.spec.ts, which used to pay a ~2s page boot per
// test just to reach these request-builder assertions.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as anthropic from '../../src/ai/anthropic';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Anthropic buildApiMessages', () => {
  test('strips an orphaned tool_result left behind by compaction', () => {
    // The mirror of the dangling-tool_use case: compaction (or any edit that
    // drops the assistant turn that made a call) can leave a kept tool_result
    // whose `tool_use_id` no longer has a matching tool_use. The API 400s with
    // "unexpected `tool_use_id`" unless the builder strips it. buildApiMessages
    // is pure, so assert directly.
    const history = [
      // A compaction summary replaced the assistant(tool_use) that made the
      // call — only the orphaned tool_result carrier survived.
      { id: 's0', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '[compacted summary]' }], createdAt: 0, seq: 0 },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'tu_GONE', content: '{"ok":true}' }], createdAt: 0, seq: 1 },
      { id: 'u2', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: 'now add a handle' }], createdAt: 0, seq: 2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const out = anthropic.buildApiMessages(history);

    // The orphaned tool_result must not survive into the request.
    const hasOrphan = out.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === 'tu_GONE'),
    );
    expect(hasOrphan).toBe(false);
    // The real user text is untouched.
    const userText = out.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'text' && b.text.includes('add a handle')),
    );
    expect(userText).toBe(true);
  });

  test('replays signed thinking blocks before tool_use during tool use', () => {
    // The riskiest invariant: when thinking is on, an assistant turn that
    // contains a tool_use must lead with its signed thinking block, or the
    // next request 400s. buildApiMessages is a pure function, so assert the
    // ordering directly. With replay off, no thinking block leaks in.
    const history = [
      {
        id: 'a1', sessionId: 's', role: 'assistant',
        blocks: [{ type: 'text', text: 'let me check' }],
        toolCalls: [{ id: 'tu_1', name: 'getGeometryData', input: {} }],
        thinkingBlocks: [{ type: 'thinking', thinking: 'I should inspect the mesh first.', signature: 'SIG_1' }],
        createdAt: 0, seq: 0,
      },
      { id: 'u1', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'tu_1', content: '{"ok":true}' }], createdAt: 0, seq: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const withReplay = anthropic.buildApiMessages(history, { replayThinking: true });
    const without = anthropic.buildApiMessages(history, { replayThinking: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst = withReplay.find((m: any) => m.role === 'assistant');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = asst.content.map((b: any) => b.type);
    expect(asst.content[0].type).toBe('thinking');
    expect(asst.content[0].signature).toBe('SIG_1');
    expect(asst.content[0].thinking).toContain('inspect the mesh');
    expect(types.indexOf('thinking')).toBeLessThan(types.indexOf('tool_use'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst2 = without.find((m: any) => m.role === 'assistant');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(asst2.content.some((b: any) => b.type === 'thinking')).toBe(false);
  });
});

describe('Anthropic thinking config', () => {
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

  test('sends the thinking param with budget when enabled, omits it when off', async () => {
    // Off must reproduce the pre-feature request exactly (no `thinking`
    // field); a non-off level enables extended thinking with budget_tokens
    // and floats max_tokens above the budget (the API requires >).
    const bodies: Record<string, { thinking?: unknown; max_tokens?: number }> = {};
    async function run(level: string, key: string) {
      anthropic.resetClient();
      vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
        bodies[key] = JSON.parse(String(init?.body ?? '{}'));
        return new Response(new Blob([SSE]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      });
      try {
        await anthropic.streamTurn({
          apiKey: 'k', model: 'claude-haiku-4-5', systemPrompt: 'sys', systemSuffix: '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          apiMessages: [{ role: 'user', content: 'hi' }] as any, tools: [], thinking: level as any,
        });
      } catch { /* body already captured; parsing differences are irrelevant here */ }
    }
    await run('off', 'off');
    await run('medium', 'medium');

    expect(bodies.off.thinking).toBeUndefined();
    expect(bodies.medium.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(bodies.medium.max_tokens as number).toBeGreaterThan(8192);
  });

  test('uses adaptive thinking + effort on adaptive-only models and self-heals a thinking-shape 400', async () => {
    // Opus 4.7+/Sonnet 5/Opus 5.x/Fable 400 on `budget_tokens`. An id the
    // catalog snapshot doesn't carry yet (claude-opus-5-5) must resolve to the
    // adaptive shape by name; a budget-shape 400 must flip shape and retry once.
    const minimalSse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      '',
    ].join('\n');
    const REJECT = JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.' },
    });
    const ok = () => new Response(new Blob([minimalSse]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    const turn = (model: string) => anthropic.streamTurn({
      apiKey: 'k', model, systemPrompt: 'sys', systemSuffix: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiMessages: [{ role: 'user', content: 'hi' }] as any, tools: [], thinking: 'medium',
    });

    // 1. Adaptive-only model not in the snapshot.
    const adaptiveBodies: Record<string, unknown>[] = [];
    anthropic.resetClient();
    vi.stubGlobal('fetch', async (_i: unknown, init: { body?: string }) => { adaptiveBodies.push(JSON.parse(String(init?.body ?? '{}'))); return ok(); });
    await turn('claude-opus-5-5');

    // 2. A budget-shape model whose API rejects budget_tokens → one retry.
    const healBodies: Record<string, unknown>[] = [];
    anthropic.resetClient();
    vi.stubGlobal('fetch', async (_i: unknown, init: { body?: string }) => {
      healBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return healBodies.length === 1
        ? new Response(REJECT, { status: 400, headers: { 'Content-Type': 'application/json' } })
        : ok();
    });
    const healed = await turn('claude-sonnet-4-5');

    expect(adaptiveBodies).toHaveLength(1);
    expect(adaptiveBodies[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(adaptiveBodies[0].output_config).toEqual({ effort: 'medium' });
    expect(healBodies).toHaveLength(2);
    expect(healBodies[0].thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(healBodies[1].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(healed.stopReason).toBe('end_turn');
  });
});
