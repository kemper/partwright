// Session trace: a self-describing JSON dump of one AI chat — every prompt,
// thinking block, tool call + result, and per-API-call telemetry (tokens,
// cache hits, cost, latency, request shape, retries) — plus rolled-up
// summaries, so another model can audit how a session spent its budget and how
// well it worked the task. Pure: callers collect the inputs (persisted chat
// messages, the in-memory AI Call Log, ai-sourced Diagnostic Log entries) and
// this module only reshapes them. Collection + download live in
// src/export/aiTrace.ts.

import type { ApiCallTrace, ChatMessage, ChatToggles, CompactionTrace, ImageSource, PersistedToolCall, TurnUsage } from './types';
import type { DiagnosticEvent } from './diagnostics';
import { turnCostUsd } from './cost';

export const TRACE_FORMAT = 'partwright-ai-session-trace';
export const TRACE_VERSION = 1;

/** Field guide embedded in every trace, so the file explains itself to
 *  whichever model is handed it. */
const README = [
  'Partwright AI session trace. One in-app AI chat, oldest first.',
  'summary: totals, cache efficiency, per-model / per-tool / per-turn rollups, and the heaviest calls + tool results.',
  'turns: one entry per human prompt — every API call and tool run until the next prompt, with the tool sequence (the agent\'s steps).',
  'timeline: every persisted message. kind = user | tool_results (tool outputs posted back to the model, plus any text the human queued mid-turn) | assistant (one API call) | auto_resume (synthetic "keep going" nudge) | compaction_summary.',
  'assistant.call: provider, model, stopReason, thinking level, agent-loop iteration, request shape (messages, offered tool names, tool-schema chars, system prompt + suffix chars, history chars, chars pruned, images sent/elided), and transient retries.',
  'Tokens: inputTokens = uncached prompt tokens; cacheReadTokens = prompt tokens served from the provider cache; cacheWriteTokens = prompt tokens written to cache; promptTokens = their sum. cacheHitRate = cacheRead / promptTokens.',
  'costUsd comes from the app\'s pricing table at the time of the call; uncachedCostUsd re-prices the same call as if nothing were cached, so cacheSavingsUsd = uncached − actual (negative = cache writes cost more than they saved).',
  'Messages replaced by a compaction are deleted; their totals survive on the compaction_summary entry (compaction.dropped) and are included in summary.totals.',
  'callLog: the AI Call Log for this browser tab since page load (also covers calls that left no message: errors, compaction, reviews, key checks). errors: AI entries from the Diagnostic Log, secrets redacted.',
  'Messages written before per-call telemetry existed have no `call`; their provider/model show as "unknown".',
].join('\n');

export interface SessionTraceInput {
  /** Persisted chat messages for the session (any order). */
  messages: ChatMessage[];
  session: { id: string; name: string | null };
  app: { version: string; commit: string; buildTime: string };
  /** The chat's current toggles (provider, models, caps, …). */
  toggles?: ChatToggles | null;
  /** The base system prompt as it would be sent now. */
  systemPrompt?: string | null;
  callLog?: DiagnosticEvent[];
  errors?: unknown[];
  exportedAt?: number;
  /** Embed base64 image data (default false: only size + label). */
  includeImages?: boolean;
  /** Embed the full system prompt text (default false: only its size). */
  includeSystemPrompt?: boolean;
  /** Chars per token used for the system-prompt token estimate. */
  charsPerToken?: number;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  promptTokens: number;
}

interface TraceImage { label?: string; mediaType: string; bytes: number; data?: string }

interface ToolStats {
  calls: number;
  errors: number;
  retried: number;
  totalMs: number;
  avgMs: number;
  inputChars: number;
  resultChars: number;
  images: number;
}

function zeroTokens(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, promptTokens: 0 };
}

function tokensOf(u: TurnUsage | undefined): TokenTotals {
  if (!u) return zeroTokens();
  const input = u.inputTokens ?? 0;
  const read = u.cacheReadInputTokens ?? 0;
  const write = u.cacheCreationInputTokens ?? 0;
  return { inputTokens: input, outputTokens: u.outputTokens ?? 0, cacheReadTokens: read, cacheWriteTokens: write, promptTokens: input + read + write };
}

function addTokens(into: TokenTotals, t: TokenTotals): void {
  into.inputTokens += t.inputTokens;
  into.outputTokens += t.outputTokens;
  into.cacheReadTokens += t.cacheReadTokens;
  into.cacheWriteTokens += t.cacheWriteTokens;
  into.promptTokens += t.promptTokens;
}

function hitRate(t: TokenTotals): number | null {
  return t.promptTokens > 0 ? round(t.cacheReadTokens / t.promptTokens, 4) : null;
}

function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function iso(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function imageOut(src: ImageSource, include: boolean): TraceImage {
  return {
    ...(src.label ? { label: src.label } : {}),
    mediaType: src.mediaType,
    bytes: Math.floor((src.data?.length ?? 0) * 3 / 4),
    ...(include ? { data: src.data } : {}),
  };
}

function jsonLength(v: unknown): number {
  try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; }
}

/** What the call would have cost with no prompt caching (every prompt token
 *  billed as fresh input). null when the model has no known pricing. */
function uncachedCost(call: ApiCallTrace | undefined, t: TokenTotals): number | null {
  if (!call) return null;
  return turnCostUsd(call.provider, call.model, {
    inputTokens: t.promptTokens,
    outputTokens: t.outputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
}

/** A user message that starts a new turn: the human typed (or attached)
 *  something, rather than the loop posting tool results or a nudge. */
function isHumanPrompt(m: ChatMessage): boolean {
  return m.role === 'user' && !m.autoResumeNudge && (m.toolResults?.length ?? 0) === 0 && m.blocks.length > 0;
}

function textOf(m: ChatMessage, type: 'text' | 'thinking'): string {
  return m.blocks.filter(b => b.type === type).map(b => (b as { text: string }).text).join('\n\n');
}

function kindOf(m: ChatMessage): string {
  if (m.role === 'assistant') return m.compacted ? 'compaction_summary' : 'assistant';
  if (m.autoResumeNudge) return 'auto_resume';
  if ((m.toolResults?.length ?? 0) > 0) return 'tool_results';
  return 'user';
}

function modelKey(m: ChatMessage): string {
  return m.call ? `${m.call.provider}/${m.call.model}` : 'unknown';
}

/** Build the trace. Deterministic for a given input (exportedAt aside). */
export function buildSessionTrace(input: SessionTraceInput) {
  const includeImages = input.includeImages === true;
  const messages = [...input.messages].sort((a, b) => a.seq - b.seq);

  // toolUseId → call, so results can be attributed to their tool.
  const callsById = new Map<string, PersistedToolCall>();
  for (const m of messages) for (const tc of m.toolCalls ?? []) callsById.set(tc.id, tc);

  const totals = zeroTokens();
  let costUsd = 0;
  let costUnknownCalls = 0;
  let uncachedUsd = 0;
  let apiMs = 0;
  let toolMs = 0;
  let apiCalls = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let retries = 0;
  let abortedCalls = 0;
  let autoResumes = 0;
  let humanPrompts = 0;
  let images = 0;
  let imageBytes = 0;
  const stopReasons: Record<string, number> = {};
  const byModel: Record<string, { calls: number; tokens: TokenTotals; costUsd: number; apiMs: number }> = {};
  const byTool: Record<string, ToolStats> = {};
  const heaviestResults: { seq: number; tool: string; chars: number; isError: boolean; hasImage: boolean }[] = [];
  const heaviestCalls: { seq: number; model: string; promptTokens: number; outputTokens: number; costUsd: number | null; tools: number; historyChars: number | null }[] = [];
  const compactions: { seq: number; at: string; droppedMessages: number; dropped: unknown; summarizer?: unknown }[] = [];
  const cacheMisses: { seq: number; model: string; promptTokens: number }[] = [];
  const seenModel = new Set<string>();

  const timeline = messages.map(m => {
    const base = {
      seq: m.seq,
      at: iso(m.createdAt),
      kind: kindOf(m),
    };
    const imgs: TraceImage[] = [];
    for (const b of m.blocks) {
      if (b.type === 'image') {
        const out = imageOut(b.source, includeImages);
        imgs.push(out);
        images++;
        imageBytes += out.bytes;
      }
    }
    const text = textOf(m, 'text');
    const reviews = m.blocks.filter(b => b.type === 'review').map(b => b as { provider: string; model: string; text: string });

    if (m.role === 'user') {
      if (isHumanPrompt(m)) humanPrompts++;
      if (m.autoResumeNudge) autoResumes++;
      const results = (m.toolResults ?? []).map(tr => {
        const tc = callsById.get(tr.toolUseId);
        const name = tc?.name ?? '(unknown tool)';
        const stats = byTool[name] ??= { calls: 0, errors: 0, retried: 0, totalMs: 0, avgMs: 0, inputChars: 0, resultChars: 0, images: 0 };
        stats.calls++;
        stats.resultChars += tr.content.length;
        stats.inputChars += tc ? jsonLength(tc.input) : 0;
        if (tr.isError) { stats.errors++; toolErrors++; }
        if ((tr.attempts ?? 1) > 1) stats.retried++;
        if (tr.durationMs != null) { stats.totalMs += tr.durationMs; toolMs += tr.durationMs; }
        let image: TraceImage | undefined;
        if (tr.image) {
          image = imageOut(tr.image, includeImages);
          stats.images++;
          images++;
          imageBytes += image.bytes;
        }
        heaviestResults.push({ seq: m.seq, tool: name, chars: tr.content.length, isError: tr.isError === true, hasImage: !!tr.image });
        return {
          toolUseId: tr.toolUseId,
          tool: name,
          isError: tr.isError === true,
          ...(tr.durationMs != null ? { durationMs: tr.durationMs } : {}),
          ...(tr.attempts ? { attempts: tr.attempts } : {}),
          contentChars: tr.content.length,
          content: tr.content,
          ...(image ? { image } : {}),
        };
      });
      return {
        ...base,
        ...(text ? { text } : {}),
        ...(imgs.length > 0 ? { images: imgs } : {}),
        ...(reviews.length > 0 ? { reviews } : {}),
        ...(results.length > 0 ? { toolResults: results } : {}),
      };
    }

    // Assistant.
    if (m.compacted) {
      if (m.compaction) {
        const d = m.compaction.dropped;
        addTokens(totals, tokensOf(d.usage));
        costUsd += d.costUsd;
        // No cache breakdown survives for deleted calls: count them at cost.
        uncachedUsd += d.costUsd;
        apiCalls += d.apiCalls;
        toolCalls += d.toolCalls;
        toolErrors += d.toolErrors;
        if (m.compaction.summarizer) {
          costUsd += m.compaction.summarizer.costUsd;
          uncachedUsd += m.compaction.summarizer.costUsd;
        }
      }
      compactions.push({
        seq: m.seq,
        at: base.at,
        droppedMessages: m.compaction?.droppedMessages ?? 0,
        dropped: m.compaction?.dropped ?? null,
        ...(m.compaction?.summarizer ? { summarizer: m.compaction.summarizer } : {}),
      });
      return { ...base, text, ...(m.compaction ? { compaction: m.compaction } : { compaction: null }) };
    }

    apiCalls++;
    const t = tokensOf(m.usage);
    addTokens(totals, t);
    const key = modelKey(m);
    const cost = m.costUsd ?? null;
    if (cost != null) costUsd += cost;
    if (m.costUnknown) costUnknownCalls++;
    const uncached = uncachedCost(m.call, t);
    uncachedUsd += uncached ?? (cost ?? 0);
    if (m.durationMs != null) apiMs += m.durationMs;
    if (m.aborted) abortedCalls++;
    const stop = m.call?.stopReason ?? (m.aborted ? 'aborted' : 'unknown');
    stopReasons[stop] = (stopReasons[stop] ?? 0) + 1;
    retries += m.call?.retries?.length ?? 0;
    const mm = byModel[key] ??= { calls: 0, tokens: zeroTokens(), costUsd: 0, apiMs: 0 };
    mm.calls++;
    addTokens(mm.tokens, t);
    mm.costUsd += cost ?? 0;
    mm.apiMs += m.durationMs ?? 0;
    // A prompt that read nothing from cache after the model's first call is
    // where caching broke (prefix changed, TTL expired, tool list shifted).
    if (m.call && seenModel.has(key) && t.promptTokens > 0 && t.cacheReadTokens === 0) {
      cacheMisses.push({ seq: m.seq, model: key, promptTokens: t.promptTokens });
    }
    seenModel.add(key);
    toolCalls += m.toolCalls?.length ?? 0;
    heaviestCalls.push({
      seq: m.seq,
      model: key,
      promptTokens: t.promptTokens,
      outputTokens: t.outputTokens,
      costUsd: cost,
      tools: m.call?.request.tools.length ?? 0,
      historyChars: m.call?.request.historyChars ?? null,
    });
    const thinking = textOf(m, 'thinking');
    return {
      ...base,
      provider: m.call?.provider ?? 'unknown',
      model: m.call?.model ?? 'unknown',
      ...(m.call ? { stopReason: m.call.stopReason, iteration: m.call.iteration, thinkingLevel: m.call.thinking } : {}),
      ...(m.aborted ? { aborted: true } : {}),
      durationMs: m.durationMs ?? null,
      tokens: t,
      cacheHitRate: hitRate(t),
      costUsd: cost,
      ...(m.costUnknown ? { costUnknown: true } : {}),
      uncachedCostUsd: uncached,
      ...(m.call ? { request: m.call.request } : {}),
      ...(m.call?.retries ? { retries: m.call.retries } : {}),
      ...(thinking ? { thinking, thinkingChars: thinking.length } : {}),
      ...(m.thinkingBlocks?.length ? { signedThinkingBlocks: m.thinkingBlocks.length } : {}),
      ...(text ? { text } : {}),
      ...(imgs.length > 0 ? { images: imgs } : {}),
      ...(reviews.length > 0 ? { reviews } : {}),
      ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, input: tc.input })) } : {}),
    };
  });

  for (const s of Object.values(byTool)) s.avgMs = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
  for (const mm of Object.values(byModel)) mm.costUsd = round(mm.costUsd);

  const turns = buildTurns(messages, callsById);

  const sp = input.systemPrompt ?? null;
  const cpt = input.charsPerToken && input.charsPerToken > 0 ? input.charsPerToken : 4;
  const first = messages[0]?.createdAt;
  const last = messages[messages.length - 1]?.createdAt;

  return {
    format: TRACE_FORMAT,
    version: TRACE_VERSION,
    exportedAt: iso(input.exportedAt ?? Date.now()),
    readme: README,
    app: input.app,
    session: input.session,
    settings: input.toggles ? sanitizeToggles(input.toggles) : null,
    systemPrompt: sp === null ? null : {
      chars: sp.length,
      estTokens: Math.round(sp.length / cpt),
      ...(input.includeSystemPrompt ? { text: sp } : {}),
    },
    summary: {
      messages: messages.length,
      humanPrompts,
      apiCalls,
      toolCalls,
      toolErrors,
      autoResumes,
      transientRetries: retries,
      abortedCalls,
      images,
      imageBytes,
      wallClockMs: first != null && last != null ? last - first : 0,
      apiMs,
      toolMs,
      tokens: totals,
      cacheHitRate: hitRate(totals),
      costUsd: round(costUsd),
      costUnknownCalls,
      uncachedCostUsd: round(uncachedUsd),
      cacheSavingsUsd: round(uncachedUsd - costUsd),
      stopReasons,
      byModel,
      byTool: Object.fromEntries(Object.entries(byTool).sort((a, b) => b[1].calls - a[1].calls)),
      heaviestCalls: heaviestCalls.sort((a, b) => b.promptTokens - a.promptTokens).slice(0, 10),
      heaviestToolResults: heaviestResults.sort((a, b) => b.chars - a.chars).slice(0, 10),
      cacheMisses: cacheMisses.slice(0, 50),
      compactions,
    },
    turns,
    timeline,
    callLog: input.callLog ?? [],
    errors: input.errors ?? [],
  };
}

export type SessionTrace = ReturnType<typeof buildSessionTrace>;

/** Group the timeline into human-prompt turns: the prompt, then every API
 *  call and tool run until the next human prompt. */
function buildTurns(messages: ChatMessage[], callsById: Map<string, PersistedToolCall>) {
  interface Turn {
    index: number;
    startSeq: number;
    at: string;
    prompt: string;
    apiCalls: number;
    toolCalls: number;
    toolErrors: number;
    autoResumes: number;
    midTurnMessages: number;
    tokens: TokenTotals;
    costUsd: number;
    apiMs: number;
    toolMs: number;
    wallMs: number;
    finalStopReason: string | null;
    models: string[];
    steps: string[];
  }
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let curStart = 0;
  let curEnd = 0;
  const close = () => {
    if (cur) { cur.wallMs = Math.max(0, curEnd - curStart); turns.push(cur); }
  };
  for (const m of messages) {
    if (m.compacted) continue;
    if (isHumanPrompt(m) || !cur) {
      close();
      const promptText = textOf(m, 'text');
      cur = {
        index: turns.length,
        startSeq: m.seq,
        at: iso(m.createdAt),
        prompt: m.role === 'user' ? (promptText.length > 300 ? promptText.slice(0, 300) + '…' : promptText) : '(continued — no prompt in history)',
        apiCalls: 0, toolCalls: 0, toolErrors: 0, autoResumes: 0, midTurnMessages: 0,
        tokens: zeroTokens(), costUsd: 0, apiMs: 0, toolMs: 0, wallMs: 0,
        finalStopReason: null, models: [], steps: [],
      };
      curStart = m.createdAt;
    }
    curEnd = m.createdAt;
    const t = cur!;
    if (m.role === 'assistant') {
      t.apiCalls++;
      addTokens(t.tokens, tokensOf(m.usage));
      t.costUsd = round(t.costUsd + (m.costUsd ?? 0));
      t.apiMs += m.durationMs ?? 0;
      t.finalStopReason = m.call?.stopReason ?? (m.aborted ? 'aborted' : null);
      const key = modelKey(m);
      if (!t.models.includes(key)) t.models.push(key);
      for (const tc of m.toolCalls ?? []) { t.toolCalls++; t.steps.push(tc.name); }
      if ((m.toolCalls?.length ?? 0) === 0) t.steps.push(m.aborted ? '(aborted)' : '(reply)');
    } else {
      if (m.autoResumeNudge) { t.autoResumes++; t.steps.push('(auto-resume)'); }
      for (const tr of m.toolResults ?? []) {
        if (tr.isError) {
          t.toolErrors++;
          const name = callsById.get(tr.toolUseId)?.name;
          // Mark the failed step so the sequence reads "runAndSave✗".
          const idx = name ? t.steps.lastIndexOf(name) : -1;
          if (idx >= 0) t.steps[idx] = `${name}✗`;
        }
        t.toolMs += tr.durationMs ?? 0;
      }
      if ((m.toolResults?.length ?? 0) > 0 && m.blocks.some(b => b.type === 'text' || b.type === 'image')) {
        t.midTurnMessages++;
        t.steps.push('(human interjection)');
      }
    }
  }
  close();
  return turns;
}

/** Toggles minus the bulky / endpoint-identifying bits. No secrets live in
 *  toggles (keys are in IndexedDB), but the custom endpoint URL can name a
 *  private host, so only whether one is set is kept. */
function sanitizeToggles(t: ChatToggles) {
  const { customModels: _models, customBaseUrl, ...rest } = t;
  return { ...rest, customBaseUrl: customBaseUrl ? '(set)' : '' };
}

/** Totals of the messages a compaction is about to delete, stamped on the
 *  summary message so the session trace can still account for their spend.
 *  Rolls up any earlier compaction summaries among them. */
export function compactionTraceFor(
  dropped: ChatMessage[],
  summarizer?: CompactionTrace['summarizer'],
): CompactionTrace {
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const out: CompactionTrace['dropped'] = { apiCalls: 0, toolCalls: 0, toolErrors: 0, usage, costUsd: 0 };
  const addUsage = (u: TurnUsage | undefined) => {
    if (!u) return;
    usage.inputTokens += u.inputTokens ?? 0;
    usage.outputTokens += u.outputTokens ?? 0;
    usage.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
    usage.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
  };
  for (const m of dropped) {
    if (m.compacted) {
      const prev = m.compaction;
      if (prev) {
        out.apiCalls += prev.dropped.apiCalls;
        out.toolCalls += prev.dropped.toolCalls;
        out.toolErrors += prev.dropped.toolErrors;
        out.costUsd += prev.dropped.costUsd + (prev.summarizer?.costUsd ?? 0);
        addUsage(prev.dropped.usage);
      }
      continue;
    }
    if (m.role === 'assistant') {
      out.apiCalls++;
      out.toolCalls += m.toolCalls?.length ?? 0;
      out.costUsd += m.costUsd ?? 0;
      addUsage(m.usage);
    }
    for (const tr of m.toolResults ?? []) if (tr.isError) out.toolErrors++;
  }
  out.costUsd = round(out.costUsd);
  return { droppedMessages: dropped.length, dropped: out, ...(summarizer ? { summarizer } : {}) };
}
