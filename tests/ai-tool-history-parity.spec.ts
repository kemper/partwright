/* eslint-disable @typescript-eslint/no-explicit-any -- wire payloads from five providers are inspected structurally */
import { test, expect } from 'playwright/test';

// Cross-provider tool-history parity (#914, acceptance criterion 3).
//
// Every provider request builder runs the shared `repairToolHistory` on the
// persisted ChatMessage history before converting it to its own wire format —
// it is the ONLY tool_use/tool_result repair on the send path. This spec pins
// that contract: for the same corrupted history, every provider (Anthropic,
// OpenAI Chat Completions, OpenAI Responses, Custom, Gemini, Local native and
// prompt-engineered) must emit the SAME repaired tool sequence — and that
// sequence must equal what `repairToolHistory` itself produces, i.e. exactly
// what the "Repair history" button writes back. If a builder ever grows its
// own divergent repair (or drops/reorders a result), this fails.
//
// Each wire format is normalized to an ordered token list:
//   user:<text>           a user text turn
//   call:<id>             an assistant tool call
//   result:<id>:<kind>    a tool result; kind = synthetic (repair-injected) | real
// Order encodes adjacency: a call's result must be the very next token.

// Gemini identifies calls/results by tool NAME, not id, so every call in the
// fixtures gets a unique name that maps back to its id.
const TOOL_NAMES: Record<string, string> = {
  call_OK: 'runOk',
  call_DANGLING: 'runDangling',
  call_TAIL: 'runTail',
  call_GONE: 'runGone',
};

const msg = (id: string, seq: number, rest: Record<string, unknown>) =>
  ({ id, sessionId: 's', createdAt: 0, seq, blocks: [], ...rest });
const text = (t: string) => [{ type: 'text', text: t }];

const SCENARIOS = [
  {
    name: 'a dangling tool_use mid-conversation and a compaction-orphaned tool_result',
    history: [
      // Compaction replaced the assistant turn that made call_GONE; only its
      // result carrier survived — an orphaned tool_result.
      msg('s0', 0, { role: 'assistant', blocks: text('[compacted summary]') }),
      msg('u0', 1, { role: 'user', toolResults: [{ toolUseId: 'call_GONE', content: '{"stale":true}' }] }),
      msg('u1', 2, { role: 'user', blocks: text('make a cube') }),
      // A complete tool round that must survive untouched.
      msg('a1', 3, { role: 'assistant', toolCalls: [{ id: 'call_OK', name: 'runOk', input: {} }] }),
      msg('u2', 4, { role: 'user', toolResults: [{ toolUseId: 'call_OK', content: '{"volume":1}' }] }),
      // An interrupted round: the call never got a result before the user
      // typed again — an orphaned tool_use.
      msg('a2', 5, { role: 'assistant', toolCalls: [{ id: 'call_DANGLING', name: 'runDangling', input: {} }] }),
      msg('u3', 6, { role: 'user', blocks: text('add a handle') }),
    ],
    expected: [
      'user:make a cube',
      'call:call_OK',
      'result:call_OK:real',
      'call:call_DANGLING',
      'result:call_DANGLING:synthetic',
      'user:add a handle',
    ],
  },
  {
    // Historically the Anthropic builder STRIPPED a trailing unanswered
    // assistant turn while every other provider answered it — the exact
    // divergence #914 set out to remove. Now all providers answer it.
    name: 'a dangling tool_use at the tail (turn stopped before any result posted)',
    history: [
      msg('u0', 0, { role: 'user', blocks: text('make a cube') }),
      msg('a1', 1, { role: 'assistant', toolCalls: [{ id: 'call_OK', name: 'runOk', input: {} }] }),
      msg('u1', 2, { role: 'user', toolResults: [{ toolUseId: 'call_OK', content: '{"volume":1}' }] }),
      msg('a2', 3, { role: 'assistant', blocks: text('Rendering now.'), toolCalls: [{ id: 'call_TAIL', name: 'runTail', input: {} }] }),
    ],
    expected: [
      'user:make a cube',
      'call:call_OK',
      'result:call_OK:real',
      'call:call_TAIL',
      'result:call_TAIL:synthetic',
    ],
  },
];

test.describe('Tool-history repair parity across providers', () => {
  for (const scenario of SCENARIOS) {
    test(`every provider emits the repairToolHistory sequence for ${scenario.name}`, async ({ page }) => {
      await page.goto('/editor');
      await page.waitForSelector('#ai-panel', { state: 'attached' });

      const out = await page.evaluate(async ({ history, names }) => {
        const anthropic = await import('/src/ai/anthropic.ts');
        const openai = await import('/src/ai/openai.ts');
        const custom = await import('/src/ai/custom.ts');
        const gemini = await import('/src/ai/gemini.ts');
        const local = await import('/src/ai/local.ts');
        const { LOCAL_MODELS } = await import('/src/ai/localModels.ts');
        const { repairToolHistory } = await import('/src/ai/historyRepair.ts');

        const idByName: Record<string, string> = {};
        for (const [id, name] of Object.entries(names)) idByName[name] = id;
        // The repair's synthetic result says the call "did not complete";
        // real results in the fixtures are JSON payloads.
        const kind = (s: string) => (/did not complete/i.test(s) ? 'synthetic' : 'real');
        const joinText = (parts: any[], type: string) =>
          parts.filter(p => p.type === type).map(p => p.text).join('');

        // --- Normalizers: one per wire format -----------------------------
        const fromChatMessages = (msgs: any[]) => {
          const t: string[] = [];
          for (const m of msgs) {
            if (m.role === 'assistant') {
              for (const tc of m.toolCalls ?? []) t.push(`call:${tc.id}`);
            } else {
              for (const r of m.toolResults ?? []) t.push(`result:${r.toolUseId}:${kind(r.content)}`);
              for (const b of m.blocks) if (b.type === 'text' && b.text.trim()) t.push(`user:${b.text}`);
            }
          }
          return t;
        };
        const fromAnthropic = (msgs: any[]) => {
          const t: string[] = [];
          for (const m of msgs) {
            const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
            for (const b of blocks) {
              if (m.role === 'assistant') {
                if (b.type === 'tool_use') t.push(`call:${b.id}`);
              } else if (b.type === 'tool_result') {
                const body = typeof b.content === 'string' ? b.content : joinText(b.content, 'text');
                t.push(`result:${b.tool_use_id}:${kind(body)}`);
              } else if (b.type === 'text' && b.text.trim()) {
                t.push(`user:${b.text}`);
              }
            }
          }
          return t;
        };
        // OpenAI Chat Completions — also the Custom and Local-native shape.
        const fromChat = (msgs: any[]) => {
          const t: string[] = [];
          for (const m of msgs) {
            if (m.role === 'assistant') {
              for (const tc of m.tool_calls ?? []) t.push(`call:${tc.id}`);
            } else if (m.role === 'tool') {
              t.push(`result:${m.tool_call_id}:${kind(String(m.content))}`);
            } else if (m.role === 'user') {
              const body = typeof m.content === 'string' ? m.content : joinText(m.content ?? [], 'text');
              if (body.trim()) t.push(`user:${body}`);
            }
          }
          return t;
        };
        const fromResponses = (items: any[]) => {
          const t: string[] = [];
          for (const it of items) {
            if (it.type === 'function_call') t.push(`call:${it.call_id}`);
            else if (it.type === 'function_call_output') t.push(`result:${it.call_id}:${kind(String(it.output))}`);
            else if (it.type === 'message' && it.role === 'user') {
              const body = joinText(it.content ?? [], 'input_text');
              if (body.trim()) t.push(`user:${body}`);
            }
          }
          return t;
        };
        const fromGemini = (contents: any[]) => {
          const t: string[] = [];
          for (const c of contents) {
            for (const p of c.parts ?? []) {
              if (c.role === 'model') {
                if (p.functionCall) t.push(`call:${idByName[p.functionCall.name] ?? '?'}`);
              } else if (p.functionResponse) {
                const id = idByName[p.functionResponse.name] ?? '?';
                t.push(`result:${id}:${kind(JSON.stringify(p.functionResponse.response))}`);
              } else if (typeof p.text === 'string' && p.text.trim()) {
                t.push(`user:${p.text}`);
              }
            }
          }
          return t;
        };
        // Local prompt-engineered path: calls/results are serialized as
        // markup. Results carry no id here, so they're tokenized as `*` and
        // compared id-agnostically (position still has to match).
        const fromLocalPrompt = (msgs: any[]) => {
          const t: string[] = [];
          for (const m of msgs) {
            const body = typeof m.content === 'string' ? m.content : '';
            if (m.role === 'assistant') {
              for (const match of body.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
                t.push(`call:${idByName[JSON.parse(match[1]).name] ?? '?'}`);
              }
            } else if (m.role === 'user') {
              for (const match of body.matchAll(/<tool_result[^>]*>\n([\s\S]*?)\n<\/tool_result>/g)) {
                t.push(`result:*:${kind(match[1])}`);
              }
              const rest = body.replace(/<tool_result[^>]*>[\s\S]*?<\/tool_result>/g, '').trim();
              if (rest) t.push(`user:${rest}`);
            }
          }
          return t;
        };

        // --- Drive the real send path for the network providers ------------
        const chatSse = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
        const responsesSse = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
        const geminiSse = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
        let captured: any = null;
        const origFetch = window.fetch;
        // @ts-expect-error test stub
        window.fetch = async (input: unknown, init: { body?: string }) => {
          const url = input instanceof Request ? input.url : String(input);
          captured = JSON.parse(String(init?.body ?? '{}'));
          const body = url.includes('generativelanguage') ? geminiSse
            : url.includes('/responses') ? responsesSse
            : chatSse;
          return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };
        // Each provider gets its own deep copy, so no builder can leak a
        // mutation into another provider's input.
        const fresh = () => structuredClone(history) as any;
        const send = async (fn: () => Promise<unknown>) => { captured = null; await fn(); return captured; };
        const base = { apiKey: 'k', systemPrompt: 'sys', systemSuffix: '', tools: [] };

        try {
          const repaired = repairToolHistory(fresh());
          const localInfo = LOCAL_MODELS[0];
          return {
            detectorFlagged: repaired.changed,
            canonical: fromChatMessages(repaired.messages),
            anthropic: fromAnthropic(anthropic.buildApiMessages(fresh())),
            openaiChat: fromChat((await send(() => openai.streamTurn({ ...base, model: 'gpt-4o', history: fresh() }))).messages),
            openaiResponses: fromResponses((await send(() => openai.streamTurn({ ...base, model: 'gpt-5.5', history: fresh() }))).input),
            custom: fromChat((await send(() => custom.streamTurn({ ...base, apiKey: '', baseUrl: 'http://example.test/v1', model: 'local-llm', history: fresh() }))).messages),
            gemini: fromGemini((await send(() => gemini.streamTurn({ ...base, model: 'gemini-2.5-flash', history: fresh() }))).contents),
            localNative: fromChat(local.buildLocalApiMessages('sys', '', fresh(), localInfo, true)),
            localPrompt: fromLocalPrompt(local.buildLocalApiMessages('sys', '', fresh(), localInfo, false)),
          };
        } finally {
          window.fetch = origFetch;
        }
      }, { history: scenario.history, names: TOOL_NAMES });

      // The UI's Repair affordance must see this history as broken...
      expect(out.detectorFlagged).toBe(true);
      // ...and the repair itself must produce the intended sequence: every
      // call answered immediately, the orphaned result gone, nothing dropped.
      expect(out.canonical).toEqual(scenario.expected);

      // Every provider sends exactly that repaired sequence.
      for (const provider of ['anthropic', 'openaiChat', 'openaiResponses', 'custom', 'gemini', 'localNative'] as const) {
        expect(out[provider], `${provider} diverged from repairToolHistory`).toEqual(out.canonical);
      }
      expect(out.localPrompt, 'localPrompt diverged from repairToolHistory')
        .toEqual(out.canonical.map(tok => tok.replace(/^result:[^:]+:/, 'result:*:')));
    });
  }
});
