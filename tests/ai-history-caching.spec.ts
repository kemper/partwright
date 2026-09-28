import { test, expect } from 'playwright/test';

// History caching + edited-history safety on the Anthropic transport, and the
// auto-compact default migration. The request builders are exercised in a
// real browser with a stubbed fetch (the SDK needs browser APIs).

const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
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

test.describe('AI history caching', () => {
  test('Anthropic: cache breakpoints on the history; drop_block + beta header for always-on models', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async (sse) => {
      const a = await import('/src/ai/anthropic.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const captured: Record<string, { body: any; beta: string | null }> = {};
      const origFetch = window.fetch;
      async function run(key: string, model: string, cacheHistory: boolean) {
        a.resetClient();
        // @ts-expect-error test stub
        window.fetch = async (_input: unknown, init: { body?: string; headers?: HeadersInit }) => {
          captured[key] = { body: JSON.parse(String(init?.body ?? '{}')), beta: new Headers(init?.headers).get('anthropic-beta') };
          return new Response(new Blob([sse]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        try {
          await a.streamTurn({
            apiKey: 'k', model, systemPrompt: 'sys', systemSuffix: '', tools: [], thinking: 'high', cacheHistory,
            apiMessages: [
              { role: 'user', content: 'make a cube' },
              { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'runAndSave', input: {} }] },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any,
          });
        } catch { /* body already captured */ }
      }
      try {
        await run('cached', 'claude-opus-4-7', true);
        await run('uncached', 'claude-opus-4-7', false);
        await run('opus55', 'claude-opus-5-5', true);
      } finally { window.fetch = origFetch; }
      return captured;
    }, SSE);
    // Last message (the tool result) and the previous user message carry a breakpoint.
    const msgs = out.cached.body.messages;
    expect(msgs[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(out.uncached.body.messages)).not.toContain('cache_control');
    // Opus 4.7 doesn't bind thinking to history: no beta, no block_binding.
    expect(out.cached.beta ?? '').not.toContain('thinking-binding');
    expect(out.cached.body.thinking.block_binding).toBeUndefined();
    // Opus 5.5 does: ask the API to drop (not 400 on) thinking whose history
    // Partwright edited (image trimming, compaction).
    expect(out.opus55.body.thinking.block_binding).toEqual({ prefix_mismatch_behavior: 'drop_block' });
    expect(out.opus55.beta).toContain('thinking-binding-controls-2026-08-01');
  });

  test('auto-compact defaults to Auto; a pre-existing "off" migrates once, a later choice sticks', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    const out = await page.evaluate(async () => {
      const s = await import('/src/ai/settings.ts');
      const KEY = 'partwright-ai-settings-v1';
      const read = () => { s.reloadSettingsFromStorage(); return s.loadSettings().autoCompactMode; };
      localStorage.removeItem(KEY);
      const fresh = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'off' }));
      const legacyOff = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'off', settingsRev: 1 }));
      const chosenOff = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'aggressive' }));
      const legacyAggressive = read();
      return { fresh, legacyOff, chosenOff, legacyAggressive };
    });
    expect(out).toEqual({ fresh: 'standard', legacyOff: 'standard', chosenOff: 'off', legacyAggressive: 'aggressive' });
  });
});
