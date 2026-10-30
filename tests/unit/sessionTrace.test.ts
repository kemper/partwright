import { describe, it, expect } from 'vitest';
import { buildSessionTrace, compactionTraceFor, TRACE_FORMAT } from '../../src/ai/sessionTrace';
import type { ApiCallTrace, ChatMessage } from '../../src/ai/types';
import { turnCostUsd } from '../../src/ai/cost';
import { CARRIED_ATTACHMENTS_NOTE } from '../../src/ai/compactionAttachments';

const MODEL = 'claude-sonnet-4-6';

function call(over: Partial<ApiCallTrace> = {}): ApiCallTrace {
  return {
    provider: 'anthropic',
    model: MODEL,
    stopReason: 'tool_use',
    thinking: 'high',
    iteration: 0,
    request: {
      messages: 1, tools: ['runAndSave', 'renderViews'], toolCount: 2, toolSchemaChars: 900,
      systemPromptChars: 40_000, systemSuffixChars: 300, historyChars: 120,
      prunedChars: 0, imagesSent: 0, imagesElided: 0,
    },
    ...over,
  };
}

let seq = 0;
function msg(m: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  seq++;
  return { id: `m${seq}`, sessionId: 's1', blocks: [], createdAt: 1_000 * seq, seq, ...m };
}

/** A two-call turn: prompt → runAndSave (fails, then retried by the model)
 *  → final reply; then a second prompt answered directly. */
function sampleChat(): ChatMessage[] {
  seq = 0;
  const usage1 = { inputTokens: 12_000, outputTokens: 400, cacheCreationInputTokens: 30_000, cacheReadInputTokens: 0 };
  const usage2 = { inputTokens: 800, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 42_000 };
  const usage3 = { inputTokens: 500, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  return [
    msg({ role: 'user', blocks: [{ type: 'text', text: 'make a cube' }, { type: 'image', source: { data: 'AAAA', mediaType: 'image/png', label: 'ref' } }] }),
    msg({
      role: 'assistant',
      blocks: [{ type: 'thinking', text: 'plan it' }],
      toolCalls: [{ id: 't1', name: 'runAndSave', input: { code: 'return x' } }],
      usage: usage1, costUsd: turnCostUsd('anthropic', MODEL, usage1)!, durationMs: 3_000,
      call: call({ retries: [{ error: 'HTTP 529 overloaded', durationMs: 900 }] }),
    }),
    msg({ role: 'user', toolResults: [{ toolUseId: 't1', content: 'ReferenceError: x', isError: true, durationMs: 120, image: { data: 'BBBBBBBB', mediaType: 'image/png' } }] }),
    msg({
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Done.' }],
      usage: usage2, costUsd: turnCostUsd('anthropic', MODEL, usage2)!, durationMs: 1_500,
      call: call({ stopReason: 'end_turn', iteration: 1 }),
    }),
    msg({ role: 'user', blocks: [{ type: 'text', text: 'thanks' }] }),
    msg({
      role: 'assistant', blocks: [{ type: 'text', text: 'np' }],
      usage: usage3, costUsd: turnCostUsd('anthropic', MODEL, usage3)!, durationMs: 700,
      call: call({ stopReason: 'end_turn' }),
    }),
  ];
}

function build(messages: ChatMessage[], extra: Partial<Parameters<typeof buildSessionTrace>[0]> = {}) {
  return buildSessionTrace({
    messages,
    session: { id: 's1', name: 'Cube' },
    app: { version: '1.2.3', commit: 'abc', buildTime: 'now' },
    exportedAt: 0,
    ...extra,
  });
}

describe('buildSessionTrace', () => {
  it('is self-describing', () => {
    const t = build(sampleChat());
    expect(t.format).toBe(TRACE_FORMAT);
    expect(t.readme).toMatch(/cacheHitRate/);
    expect(t.session).toEqual({ id: 's1', name: 'Cube' });
  });

  it('totals tokens, cost, cache efficiency and counts', () => {
    const t = build(sampleChat());
    const s = t.summary;
    expect(s.humanPrompts).toBe(2);
    expect(s.apiCalls).toBe(3);
    expect(s.toolCalls).toBe(1);
    expect(s.toolErrors).toBe(1);
    expect(s.transientRetries).toBe(1);
    expect(s.images).toBe(2);
    expect(s.tokens).toEqual({ inputTokens: 13_300, outputTokens: 650, cacheReadTokens: 42_000, cacheWriteTokens: 30_000, promptTokens: 85_300 });
    expect(s.cacheHitRate).toBeCloseTo(42_000 / 85_300, 3);
    expect(s.costUsd).toBeGreaterThan(0);
    // The cache-read call is cheaper than it would be uncached.
    expect(s.uncachedCostUsd).toBeGreaterThan(0);
    expect(s.stopReasons).toEqual({ tool_use: 1, end_turn: 2 });
    expect(s.byModel[`anthropic/${MODEL}`].calls).toBe(3);
    expect(s.byTool.runAndSave).toMatchObject({ calls: 1, errors: 1, totalMs: 120, images: 1 });
    expect(s.heaviestCalls[0].promptTokens).toBe(42_800);
    // Third call (seq 6) read nothing from cache after the model's first call.
    expect(s.cacheMisses.map(m => m.seq)).toEqual([6]);
  });

  it('groups calls into human-prompt turns with an ordered step list', () => {
    const t = build(sampleChat());
    expect(t.turns).toHaveLength(2);
    expect(t.turns[0]).toMatchObject({ prompt: 'make a cube', apiCalls: 2, toolCalls: 1, toolErrors: 1, finalStopReason: 'end_turn' });
    expect(t.turns[0].steps).toEqual(['runAndSave✗', '(reply)']);
    expect(t.turns[1]).toMatchObject({ prompt: 'thanks', apiCalls: 1, toolCalls: 0 });
  });

  it('keeps full tool payloads and thinking but strips image data by default', () => {
    const t = build(sampleChat());
    const a = t.timeline.find(e => e.kind === 'assistant') as Record<string, unknown>;
    expect(a.thinking).toBe('plan it');
    expect(a.toolCalls).toEqual([{ id: 't1', name: 'runAndSave', input: { code: 'return x' } }]);
    expect(a.request).toMatchObject({ tools: ['runAndSave', 'renderViews'] });
    const r = t.timeline.find(e => e.kind === 'tool_results') as { toolResults: Record<string, unknown>[] };
    expect(r.toolResults[0]).toMatchObject({ tool: 'runAndSave', isError: true, content: 'ReferenceError: x', image: { mediaType: 'image/png', bytes: 6 } });
    expect((r.toolResults[0].image as Record<string, unknown>).data).toBeUndefined();

    const withImages = build(sampleChat(), { includeImages: true });
    const r2 = withImages.timeline.find(e => e.kind === 'tool_results') as { toolResults: { image: { data: string } }[] };
    expect(r2.toolResults[0].image.data).toBe('BBBBBBBB');
  });

  it('includes the system prompt text only when asked', () => {
    expect(build(sampleChat(), { systemPrompt: 'x'.repeat(400) }).systemPrompt).toEqual({ chars: 400, estTokens: 100 });
    expect(build(sampleChat(), { systemPrompt: 'abc', includeSystemPrompt: true }).systemPrompt).toMatchObject({ text: 'abc' });
  });

  it('marks messages written before call telemetry as unknown', () => {
    const chat = sampleChat().map(m => ({ ...m, call: undefined }));
    const t = build(chat);
    expect(Object.keys(t.summary.byModel)).toEqual(['unknown']);
    expect(t.summary.cacheMisses).toEqual([]);
  });

  it('keeps the spend of compacted-away turns via the summary message', () => {
    const chat = sampleChat();
    const dropped = chat.slice(0, 4);
    const compaction = compactionTraceFor(dropped, { model: 'claude-haiku-4-5', inputTokens: 5_000, outputTokens: 300, costUsd: 0.01 });
    expect(compaction.droppedMessages).toBe(4);
    expect(compaction.dropped).toMatchObject({ apiCalls: 2, toolCalls: 1, toolErrors: 1 });

    const summary: ChatMessage = { id: 'c', sessionId: 's1', role: 'assistant', blocks: [{ type: 'text', text: '[compacted summary]' }], createdAt: 0, seq: -1, compacted: true, compaction };
    const full = build(chat);
    const compacted = build([summary, ...chat.slice(4)]);
    // The summarizer call is counted on top of the replaced calls.
    expect(compacted.summary.apiCalls).toBe(full.summary.apiCalls + 1);
    expect(compacted.summary.tokens.inputTokens).toBe(full.summary.tokens.inputTokens + 5_000);
    expect(compacted.summary.tokens.outputTokens).toBe(full.summary.tokens.outputTokens + 300);
    expect(compacted.summary.tokens.cacheReadTokens).toBe(full.summary.tokens.cacheReadTokens);
    expect(compacted.summary.costUsd).toBeCloseTo(full.summary.costUsd + 0.01, 6);
    expect(compacted.summary.compactions).toHaveLength(1);

    // A second compaction rolls the first one's totals up.
    const again = compactionTraceFor([summary, ...chat.slice(4)]);
    expect(again.dropped.apiCalls).toBe(4); // 2 + summarizer + 1
    expect(again.dropped.costUsd).toBeCloseTo(full.summary.costUsd + 0.01, 6);
  });

  it('drops the custom endpoint URL from the settings snapshot', () => {
    const t = build(sampleChat(), { toggles: { customBaseUrl: 'http://10.0.0.5:8080/v1', customModels: ['a', 'b'], provider: 'custom' } as never });
    expect(t.settings).toMatchObject({ customBaseUrl: '(set)', provider: 'custom' });
    expect((t.settings as Record<string, unknown>).customModels).toBeUndefined();
  });

  it('carries a tool list forward when a call stored none (unchanged)', () => {
    const chat = sampleChat();
    const second = chat[3];
    second.call = call({ stopReason: 'end_turn', iteration: 1, request: { ...call().request, tools: undefined } });
    const t = build(chat);
    const calls = t.timeline.filter(e => e.kind === 'assistant') as { request: { tools: string[] | null } }[];
    expect(calls[1].request.tools).toEqual(['runAndSave', 'renderViews']);
  });

  it('keeps reviews, carried attachments and auto-review prompts out of the agent counts', () => {
    const chat = sampleChat();
    seq = 100;
    chat.push(
      msg({ role: 'assistant', blocks: [{ type: 'review', provider: 'openai', model: 'gpt-5', text: 'looks fine' }], usage: { inputTokens: 1_000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, costUsd: 0.02 }),
      msg({ role: 'user', blocks: [{ type: 'text', text: '[Automatic review] fix the base' }] }),
      msg({ role: 'assistant', blocks: [{ type: 'text', text: 'fixed' }], usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, costUsd: 0.001, call: call({ stopReason: 'end_turn' }) }),
    );
    const t = build(chat);
    expect(t.summary.humanPrompts).toBe(2);
    expect(t.summary.apiCalls).toBe(4);
    expect(t.summary.reviews).toBe(1);
    expect(t.summary.byModel['openai/gpt-5'].calls).toBe(1);
    expect(t.timeline.map(e => e.kind)).toContain('review');
    expect(t.timeline.map(e => e.kind)).toContain('auto_review_followup');
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].steps).toEqual(['(reply)', '(review: openai/gpt-5)', '(auto-review follow-up)', '(reply)']);
  });

  it('measures wall clock by time even when a compaction summary sorts first', () => {
    const chat = sampleChat().slice(4);
    const summary: ChatMessage = { id: 'c', sessionId: 's1', role: 'assistant', blocks: [{ type: 'text', text: '[compacted summary]' }], createdAt: 99_000, seq: -1, compacted: true };
    const carried: ChatMessage = { id: 'r', sessionId: 's1', role: 'user', blocks: [{ type: 'text', text: CARRIED_ATTACHMENTS_NOTE }], createdAt: 99_000, seq: -2 };
    const t = build([carried, summary, ...chat]);
    expect(t.summary.wallClockMs).toBe(99_000 - 5_000);
    expect(t.summary.humanPrompts).toBe(1);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0].wallMs).toBe(1_000);
  });

  it('marks the failing call when a batch runs the same tool twice', () => {
    seq = 0;
    const chat = [
      msg({ role: 'user', blocks: [{ type: 'text', text: 'go' }] }),
      msg({ role: 'assistant', toolCalls: [{ id: 'a', name: 'query', input: {} }, { id: 'b', name: 'query', input: {} }], call: call() }),
      msg({ role: 'user', toolResults: [{ toolUseId: 'a', content: 'bad', isError: true }, { toolUseId: 'b', content: 'ok' }] }),
    ];
    expect(build(chat).turns[0].steps).toEqual(['query✗', 'query']);
  });

  it('does not report cache misses for providers without prompt caching', () => {
    const chat = sampleChat().map(m => m.call ? { ...m, call: { ...m.call, provider: 'local' as const } } : m);
    expect(build(chat).summary.cacheMisses).toEqual([]);
  });
});
