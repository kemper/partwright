import { test, expect } from 'playwright/test';

// Coverage for surfacing tool-returned renderings (renderView / renderViews
// snapshots) in the chat transcript. Two halves:
//
//  1. chatLoop fires onToolResultsPersisted with the image-bearing
//     tool_result message as soon as a tool batch completes — this is what
//     lets the panel drop the rendering into the LIVE transcript instead of
//     only after a session reload.
//  2. A persisted tool_result message that carries an image renders the
//     image inline in the transcript, auto-expanded (no chip to open).

// A 1x1 transparent PNG — enough to assert the bytes round-trip into an <img>.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.describe('Tool-result renderings in the chat transcript', () => {
  test('chatLoop surfaces the renderViews image to the panel as the turn runs', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');

    const captured = await page.evaluate(async ({ tinyPng }) => {
      const cl = await import('/src/ai/chatLoop.ts');
      const a = await import('/src/ai/anthropic.ts');

      // Two canned Anthropic SSE responses: the first asks for a renderViews
      // tool call, the second ends the turn. The agent loop runs the tool in
      // between via the injected executeToolFn.
      const toolUseStream = [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_tool","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":1}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_render","name":"renderViews","input":{}}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"views\\": \\"all\\"}"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":8}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n');

      const endTurnStream = [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_end","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":30,"output_tokens":1}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Verified the views."}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n');

      const origFetch = window.fetch;
      let call = 0;
      // @ts-expect-error test stub
      window.fetch = async (input: unknown, init?: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
        if (url.includes('anthropic')) {
          const body = call === 0 ? toolUseStream : endTurnStream;
          call++;
          return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        // Delegate everything else (notably the /ai.md system-prompt fetch).
        return origFetch(input as RequestInfo, init as RequestInit);
      };

      a.resetClient();
      const toggles = {
        vision: { views: true },
        scope: { runCode: true, saveVersions: true, paintFaces: true },
        autoRetry: 0,
        maxIterations: 'medium',
        maxSpend: 'high',
        thinking: 'off',
        provider: 'anthropic',
        anthropicModel: 'claude-haiku-4-5',
        localModel: null,
        openaiModel: 'gpt-5-mini',
        geminiModel: 'gemini-3.5-flash',
      };

      const persisted: Array<{ toolResults?: unknown }> = [];
      try {
        await cl.runTurn(
          {
            apiKey: 'test-key',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            toggles: toggles as any,
            sessionId: 'test-tool-result-images',
            history: [],
            userBlocks: [{ type: 'text', text: 'render the views and verify' }],
            executeToolFn: async (name: string) => {
              if (name === 'renderViews') {
                return {
                  content: 'Rendered views: all composite. The image is attached to this result.',
                  isError: false,
                  image: { data: tinyPng, mediaType: 'image/png', label: 'views: all composite' },
                };
              }
              return { content: '(ok)', isError: false };
            },
          },
          {
            onToolResultsPersisted: (msg) => {
              persisted.push({ toolResults: msg.toolResults });
            },
          },
        );
      } finally {
        window.fetch = origFetch;
      }
      return persisted;
    }, { tinyPng: TINY_PNG });

    // The callback fired once, for the single renderViews tool batch, and the
    // persisted tool_result carried the rendered image bytes + label.
    expect(captured).toHaveLength(1);
    const results = captured[0].toolResults as Array<{ content: string; image?: { data: string; label?: string } }>;
    expect(results).toHaveLength(1);
    expect(results[0].image).toBeTruthy();
    expect(results[0].image!.data).toBe(TINY_PNG);
    expect(results[0].image!.label).toBe('views: all composite');
    expect(results[0].content).toContain('Rendered views');
  });

  test('a persisted tool_result image renders inline in the transcript', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.waitForSelector('#ai-panel');

    await page.evaluate(async ({ tinyPng }) => {
      const db = await import('/src/ai/db.ts');
      const sm = await import('/src/storage/sessionManager.ts');
      const sid = sm.getState().session?.id ?? db.GLOBAL_CHAT_BUCKET;
      await db.putMessages([
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: 'm-tc-1', sessionId: sid, role: 'assistant',
          blocks: [{ type: 'text', text: 'Let me look at all four views.' }],
          toolCalls: [{ id: 'toolu_render', name: 'renderViews', input: { views: 'all' } }],
          createdAt: Date.now(), seq: 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: 'm-tr-1', sessionId: sid, role: 'user', blocks: [],
          toolResults: [{
            toolUseId: 'toolu_render',
            content: 'Rendered views: all composite. The image is attached to this result.',
            isError: false,
            image: { data: tinyPng, mediaType: 'image/png', label: 'views: all composite' },
          }],
          createdAt: Date.now(), seq: 2,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]);
    }, { tinyPng: TINY_PNG });

    await page.reload();
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');

    // The rendering shows as an <img> in the transcript, visible without the
    // user expanding anything (image-bearing tool results auto-expand).
    const rendering = page.locator(`#ai-panel img[src*="${TINY_PNG.slice(0, 24)}"]`);
    await expect(rendering).toBeVisible();
    // The result chip carrying it defaulted to open.
    const resultChip = page.locator('#ai-panel details', { hasText: 'Rendered views' });
    await expect(resultChip).toHaveAttribute('open', '');
    // The tool call's parameters are still inspectable on its own chip.
    const callChip = page.locator('#ai-panel details', { hasText: 'renderViews' }).first();
    await callChip.locator('summary').dispatchEvent('click');
    await expect(callChip.locator('pre')).toContainText('"views": "all"');
  });
});
