import { test, expect } from 'playwright/test';
import { openAiPanel, waitForChatSessionId, waitForEditorReady } from './helpers/aiPanel';

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
      const read = () => { s.reloadSettingsFromStorage(); const l = s.loadSettings(); return `${l.autoCompactMode}/${l.autoCompactUserSet ? 'user' : 'default'}`; };
      localStorage.removeItem(KEY);
      const fresh = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'off' }));
      const legacyOff = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'off', settingsRev: 1 }));
      const chosenOff = read();
      localStorage.setItem(KEY, JSON.stringify({ autoCompactMode: 'aggressive' }));
      const legacyAggressive = read();
      s.saveSettings(s.setAutoCompactMode(s.loadSettings(), 'standard'));
      const picked = read();
      return { fresh, legacyOff, chosenOff, legacyAggressive, picked };
    });
    // "default" vs "user" matters for Local: a defaulted Auto doesn't compact
    // its tiny window after every turn; a picked one does.
    expect(out).toEqual({
      fresh: 'standard/default',
      legacyOff: 'standard/default',
      chosenOff: 'off/default',
      legacyAggressive: 'aggressive/user',
      picked: 'standard/user',
    });
  });

  test('compaction keeps images the user attached (carried before the summary)', async ({ page }) => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
    // The summarizer call (non-streaming messages.create).
    await page.route('https://api.anthropic.com/**', route => route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'SUMMARY:\nThe user wants a figurine matching their photo.\n\nNOTES:\n' }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    }));
    await page.goto('/editor');
    await waitForEditorReady(page);
    const sid = await waitForChatSessionId(page);
    await page.evaluate(async ({ sid, png }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('partwright');
        open.onsuccess = () => {
          const db = open.result;
          const txn = db.transaction('aiKeys', 'readwrite');
          txn.objectStore('aiKeys').put({ provider: 'anthropic', apiKey: 'sk-ant-test', createdAt: Date.now(), lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
      const s = await import('/src/ai/settings.ts');
      s.saveSettings(s.setToggles(s.loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-haiku-4-5' }));
      const db = await import('/src/ai/db.ts');
      const msg = (seq: number, role: 'user' | 'assistant', text: string, image = false) => ({
        id: `m${seq}`, sessionId: sid, role, createdAt: seq, seq,
        blocks: image
          ? [{ type: 'text', text }, { type: 'image', source: { data: png, mediaType: 'image/png', label: 'reference.png' } }]
          : [{ type: 'text', text }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.putMessages([
        msg(1, 'user', 'Make a figurine that looks like this photo', true),
        msg(2, 'assistant', 'Built a first pass.'),
        msg(3, 'user', 'Bigger head'),
        msg(4, 'assistant', 'Done.'),
        msg(5, 'user', 'Add a hat'),
        msg(6, 'assistant', 'Added.'),
        msg(7, 'user', 'Thinner arms'),
        msg(8, 'assistant', 'Thinned.'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
    }, { sid, png: PNG });
    await page.reload();
    await waitForEditorReady(page);
    await openAiPanel(page);
    await expect(page.locator('#ai-panel').getByText('Thinner arms')).toBeVisible({ timeout: 15_000 });
    await page.locator('#ai-panel button[title^="Compact the conversation"]').dispatchEvent('click');
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(page.locator('#ai-panel').getByText(/Compacted \d+ turn/)).toBeVisible({ timeout: 15_000 });
    const stored = await page.evaluate(async (sid) => {
      const db = await import('/src/ai/db.ts');
      const msgs = await db.listMessages(sid);
      return msgs.map(m => ({ role: m.role, compacted: !!m.compacted, images: m.blocks.filter(b => b.type === 'image').length, text: (m.blocks.find(b => b.type === 'text') as { text?: string } | undefined)?.text?.slice(0, 40) }));
    }, sid);
    // [user: carried reference photo][assistant: summary][kept tail…]
    expect(stored[0]).toMatchObject({ role: 'user', images: 1 });
    expect(stored[0].text).toContain('Reference images');
    expect(stored[1]).toMatchObject({ role: 'assistant', compacted: true });
    expect(stored.some(m => m.text === 'Make a figurine that looks like this photo')).toBe(false);
  });
});
