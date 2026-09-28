// Unit tests for the Custom OpenAI-compatible provider (src/ai/custom.ts).
// Pure logic driven with a stubbed global `fetch` — Node 22 ships native
// fetch/Response/Blob/Headers, so no browser is needed. Moved out of
// tests/ai-providers.spec.ts, which used to pay a ~2s page boot per test just
// to reach these request-builder assertions.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as custom from '../../src/ai/custom';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Custom OpenAI-compatible endpoint', () => {
  // The custom provider reuses the OpenAI Chat Completions transport but
  // targets a user-supplied base URL (e.g. a self-hosted llama.cpp server),
  // omits the Authorization header when no key is set, and NEVER uses the
  // Responses API (self-hosted servers don't implement /v1/responses).
  test('targets its base URL, omits auth when keyless, and forces Chat Completions', async () => {
    let url = '';
    let captured = '';
    let authHeader: string | null = null;
    vi.stubGlobal('fetch', async (input: unknown, init: { body?: string; headers?: Record<string, string> }) => {
      url = String(input);
      captured = String(init?.body ?? '');
      authHeader = new Headers(init?.headers as HeadersInit).get('authorization');
      const body = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    // The model name deliberately matches the reasoning sniff (gpt-5.5) to
    // prove the custom path still uses Chat Completions, not /v1/responses.
    await custom.streamTurn({ apiKey: '', baseUrl: 'http://example.test/v1', model: 'gpt-5.5', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools: [] });

    const sentBody = JSON.parse(captured);
    expect(url).toBe('http://example.test/v1/chat/completions');
    expect(url).not.toContain('/responses');
    // No key → no Authorization header (keyless self-hosted server).
    expect(authHeader).toBeNull();
    // Chat-shaped body, and no reasoning request (custom always sends thinking off).
    expect(Array.isArray(sentBody.messages)).toBe(true);
    expect(sentBody.max_completion_tokens).toBeGreaterThan(0);
    expect(sentBody.reasoning_effort).toBeUndefined();
    // Thinking omitted (= off) → no reasoning-visibility request either.
    expect(sentBody.include_reasoning).toBeUndefined();
  });

  // Thinking models behind a bridge like CLIProxyAPI (Claude Opus/Sonnet 5,
  // Codex) reason silently unless asked to show it, and stream any reasoning
  // as `reasoning_content`. Dropping those deltas left the stall watchdog
  // starved for the whole thinking phase, so every turn timed out.
  test('requests + streams reasoning_content to the thinking channel when Thinking is on', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_input: unknown, init: { body?: string }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      const body = [
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"Plan the "},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"reasoning":"base."},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
        '',
      ].join('\n\n');
      return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const thoughts: string[] = [];
    const spec = { apiKey: '', baseUrl: 'http://localhost:8317/v1', model: 'claude-opus-5', systemPrompt: 'sys', systemSuffix: '', history: [] as never[], tools: [] };
    const on = await custom.streamTurn({ ...spec, thinking: 'high' }, { onThinking: d => thoughts.push(d) });
    await custom.streamTurn({ ...spec, thinking: 'off' });

    expect(thoughts).toEqual(['Plan the ', 'base.']);
    expect(on.thinking).toBe('Plan the base.');
    expect(on.text).toBe('Done');
    expect(bodies[0].include_reasoning).toBe(true);
    // Visibility only — never a depth request the server might reject.
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].include_reasoning).toBeUndefined();
  });

  test('listModels hits /models with auth when keyed, and does not filter ids', async () => {
    let url = '';
    let authHeader: string | null = null;
    vi.stubGlobal('fetch', async (input: unknown, init: { headers?: Record<string, string> }) => {
      url = String(input);
      authHeader = new Headers(init?.headers as HeadersInit).get('authorization');
      const body = JSON.stringify({ data: [{ id: 'my-local-llama-3.3' }, { id: 'whisper-tiny' }] });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    // Trailing slash on the base URL should be trimmed before appending /models.
    const models = await custom.listModels('http://example.test/v1/', 'secret-key');
    const ids = models.map(m => m.id);

    expect(url).toBe('http://example.test/v1/models');
    expect(authHeader).toBe('Bearer secret-key');
    // Unlike the OpenAI helper, no gpt-/o- filter — a self-hosted server's
    // arbitrary ids all come through (even a "whisper" id OpenAI would drop).
    expect(ids).toContain('my-local-llama-3.3');
    expect(ids).toContain('whisper-tiny');
  });
});
