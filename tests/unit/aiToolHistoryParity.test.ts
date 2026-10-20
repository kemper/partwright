/* eslint-disable @typescript-eslint/no-explicit-any -- wire payloads from five providers are inspected structurally */
// Cross-provider tool-history parity (#914, acceptance criterion 3). Pure
// logic — every provider request builder is driven directly with a stubbed
// global `fetch`; Node 22's native fetch/Response/Blob is enough, so this
// moved out of tests/ai-tool-history-parity.spec.ts (no browser needed).
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
//   result:<id>:<kind>    a tool result; kind = synthetic (repair-injected) | real,
//                         suffixed `+img` when the result's rendered image rides along
//   image:<id>            an OpenAI image side-message sent BEFORE another tool
//                         result — i.e. wedged inside the result block, which
//                         breaks adjacency on strict backends (the #927 bug)
// Order encodes adjacency: a call's result must be the very next token.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as anthropic from '../../src/ai/anthropic';
import * as openai from '../../src/ai/openai';
import * as custom from '../../src/ai/custom';
import * as gemini from '../../src/ai/gemini';
import * as local from '../../src/ai/local';
import { LOCAL_MODELS } from '../../src/ai/localModels';
import { repairToolHistory } from '../../src/ai/historyRepair';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Gemini identifies calls/results by tool NAME, not id, so every call in the
// fixtures gets a unique name that maps back to its id.
const TOOL_NAMES: Record<string, string> = {
  call_OK: 'runOk',
  call_DANGLING: 'runDangling',
  call_TAIL: 'runTail',
  call_GONE: 'runGone',
  call_RENDER: 'runRender',
  call_QUERY: 'runQuery',
};
const idByName: Record<string, string> = {};
for (const [id, name] of Object.entries(TOOL_NAMES)) idByName[name] = id;

const msg = (id: string, seq: number, rest: Record<string, unknown>) =>
  ({ id, sessionId: 's', createdAt: 0, seq, blocks: [], ...rest });
const text = (t: string) => [{ type: 'text', text: t }];

const SCENARIOS = [
  {
    name: 'a dangling tool_use mid-conversation and a compaction-orphaned tool_result',
    needsRepair: true,
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
    // Before #927 routed every builder through repairToolHistory, the
    // Anthropic builder STRIPPED a trailing unanswered assistant turn while
    // every other provider answered it — the exact divergence #914 set out to
    // remove. Pinned here so it can't come back.
    name: 'a dangling tool_use at the tail (turn stopped before any result posted)',
    needsRepair: true,
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
  {
    // The #927 repro: a CLEAN history (nothing for the Repair button to fix)
    // where an earlier result in a multi-tool round carries a rendered image.
    // Each wire format places that image differently, but none may split the
    // result block — on OpenAI the image side-message must follow ALL the
    // `tool` / function_call_output items, or a strict backend 400s.
    name: 'a clean multi-tool round whose first result carries an image',
    needsRepair: false,
    history: [
      msg('u0', 0, { role: 'user', blocks: text('render it and measure it') }),
      msg('a1', 1, { role: 'assistant', toolCalls: [
        { id: 'call_RENDER', name: 'runRender', input: {} },
        { id: 'call_QUERY', name: 'runQuery', input: {} },
      ] }),
      msg('u1', 2, { role: 'user', toolResults: [
        { toolUseId: 'call_RENDER', content: '{"rendered":true}', image: { data: 'AAAA', mediaType: 'image/png', label: 'iso' } },
        { toolUseId: 'call_QUERY', content: '{"volume":10}' },
      ] }),
      msg('u2', 3, { role: 'user', blocks: text('now add a handle') }),
    ],
    expected: [
      'user:render it and measure it',
      'call:call_RENDER',
      'call:call_QUERY',
      'result:call_RENDER:real+img',
      'result:call_QUERY:real',
      'user:now add a handle',
    ],
  },
];

// The repair's synthetic result says the call "did not complete"; real
// results in the fixtures are JSON payloads.
const kind = (s: string) => (/did not complete/i.test(s) ? 'synthetic' : 'real');
const joinText = (parts: any[], type: string) =>
  parts.filter(p => p.type === type).map(p => p.text).join('');
const res = (id: string, body: string, img: boolean) =>
  `result:${id}:${kind(body)}${img ? '+img' : ''}`;
// OpenAI can't put an image in a tool result, so it rides on a following
// user message marked "(tool result image for <id>)". Fold it into that
// result's token — unless another tool result still follows it, which means
// it was wedged inside the result block (#927).
const IMAGE_MARKER = /^\(tool result image for (.+)\)$/;
const foldImage = (t: string[], id: string, resultFollows: boolean) => {
  const at = t.findLastIndex(tok => tok.startsWith(`result:${id}:`));
  if (resultFollows || at < 0) t.push(`image:${id}`);
  else t[at] += '+img';
};

// --- Normalizers: one per wire format -----------------------------
const fromChatMessages = (msgs: any[]) => {
  const t: string[] = [];
  for (const m of msgs) {
    if (m.role === 'assistant') {
      for (const tc of m.toolCalls ?? []) t.push(`call:${tc.id}`);
    } else {
      for (const r of m.toolResults ?? []) t.push(res(r.toolUseId, r.content, !!r.image));
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
        const img = Array.isArray(b.content) && b.content.some((c: any) => c.type === 'image');
        t.push(res(b.tool_use_id, body, img));
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
  msgs.forEach((m, i) => {
    if (m.role === 'assistant') {
      for (const tc of m.tool_calls ?? []) t.push(`call:${tc.id}`);
    } else if (m.role === 'tool') {
      t.push(res(m.tool_call_id, String(m.content), false));
    } else if (m.role === 'user') {
      const body = typeof m.content === 'string' ? m.content : joinText(m.content ?? [], 'text');
      const imageFor = body.match(IMAGE_MARKER);
      if (imageFor) foldImage(t, imageFor[1], msgs[i + 1]?.role === 'tool');
      else if (body.trim()) t.push(`user:${body}`);
    }
  });
  return t;
};
const fromResponses = (items: any[]) => {
  const t: string[] = [];
  items.forEach((it, i) => {
    if (it.type === 'function_call') t.push(`call:${it.call_id}`);
    else if (it.type === 'function_call_output') t.push(res(it.call_id, String(it.output), false));
    else if (it.type === 'message' && it.role === 'user') {
      const body = joinText(it.content ?? [], 'input_text');
      const imageFor = body.match(IMAGE_MARKER);
      if (imageFor) foldImage(t, imageFor[1], items[i + 1]?.type === 'function_call_output');
      else if (body.trim()) t.push(`user:${body}`);
    }
  });
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
        t.push(res(id, JSON.stringify(p.functionResponse.response), false));
      } else if (p.inlineData && t.length > 0 && t[t.length - 1].startsWith('result:')) {
        t[t.length - 1] += '+img';
      } else if (typeof p.text === 'string' && p.text.trim()) {
        t.push(`user:${p.text}`);
      }
    }
  }
  return t;
};
// Local prompt-engineered path: calls/results are serialized as markup.
// Results carry no id here, so they're tokenized as `*` and compared
// id-agnostically (position still has to match).
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

describe('Tool-history repair parity across providers', () => {
  for (const scenario of SCENARIOS) {
    test(`every provider emits the repairToolHistory sequence for ${scenario.name}`, async () => {
      // --- Drive the real send path for the network providers ------------
      const chatSse = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      const responsesSse = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      const geminiSse = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\n';
      let captured: any = null;
      vi.stubGlobal('fetch', async (input: unknown, init: { body?: string }) => {
        const url = input instanceof Request ? input.url : String(input);
        captured = JSON.parse(String(init?.body ?? '{}'));
        const body = url.includes('generativelanguage') ? geminiSse
          : url.includes('/responses') ? responsesSse
          : chatSse;
        return new Response(new Blob([body]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      });
      // Each provider gets its own deep copy, so no builder can leak a
      // mutation into another provider's input.
      const fresh = () => structuredClone(scenario.history) as any;
      const send = async (fn: () => Promise<unknown>) => { captured = null; await fn(); return captured; };
      const base = { apiKey: 'k', systemPrompt: 'sys', systemSuffix: '', tools: [] };

      const repaired = repairToolHistory(fresh());
      const localInfo = LOCAL_MODELS[0];
      const out = {
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

      // The UI's Repair affordance must agree on whether this history is
      // broken...
      expect(out.detectorFlagged).toBe(scenario.needsRepair);
      // ...and the repair itself must produce the intended sequence: every
      // call answered immediately, any orphaned result gone, nothing dropped.
      expect(out.canonical).toEqual(scenario.expected);

      // Every provider sends exactly that repaired sequence.
      for (const provider of ['anthropic', 'openaiChat', 'openaiResponses', 'custom', 'gemini'] as const) {
        expect(out[provider], `${provider} diverged from repairToolHistory`).toEqual(out.canonical);
      }
      // Local models don't receive tool-result images (WebLLM has no image slot
      // for them), so compare Local with the image marker dropped.
      const noImg = out.canonical.map(tok => tok.replace(/\+img$/, ''));
      expect(out.localNative, 'localNative diverged from repairToolHistory').toEqual(noImg);
      expect(out.localPrompt, 'localPrompt diverged from repairToolHistory')
        .toEqual(noImg.map(tok => tok.replace(/^result:[^:]+:/, 'result:*:')));
    });
  }
});
