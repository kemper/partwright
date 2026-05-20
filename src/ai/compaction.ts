// Manual compaction. The user clicks "Compact" → we ask Haiku to (a)
// summarize the transcript and (b) propose session notes worth promoting
// into the durable session log. The user reviews the proposal in a confirm
// modal; on accept, the chat history collapses to a single summary block +
// the most recent N turns, and the proposed notes are written to
// window.partwright.addSessionNote so they survive future compactions.

import { summarize } from './anthropic';
import { summarize as summarizeOpenai } from './openai';
import { summarize as summarizeGemini } from './gemini';
import { summarizeLocal } from './local';
import { recordEvent } from './diagnostics';
import { turnCostUsd } from './cost';
import { getKey } from './db';
import type { ChatMessage, ChatToggles, Provider } from './types';

/** Per-provider cheap model used for compaction. The big models cost too
 *  much for a summarize call we'll fire after most longer sessions. */
const COMPACTION_MODEL: Record<Exclude<Provider, 'local'>, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash-lite',
};

export interface CompactionProposal {
  /** Plain-text summary of the conversation up to the kept tail. */
  summary: string;
  /** Notes the user can opt to promote into the persistent session log.
   *  Each is already prefixed with one of the standard tags. */
  proposedNotes: string[];
  /** Messages the compaction will keep verbatim — the summary replaces the
   *  rest. By default we keep the last 4. */
  keep: ChatMessage[];
  /** Messages that will be deleted on accept. */
  drop: ChatMessage[];
  /** Cost of the compaction call itself, USD. */
  costUsd: number;
  /** Token usage of the compaction call. */
  usage: { inputTokens: number; outputTokens: number };
}

const DEFAULT_KEEP_TAIL = 4;

const COMPACTION_SYSTEM = `You are condensing a Partwright modeling-session transcript so the
follow-up conversation pays less for context. Output ONLY a JSON object,
no prose:

{
  "summary": "<2-3 paragraphs that capture: the user's goal, the design
              direction taken, key parameters chosen, what's currently in
              the editor, and any unresolved questions. Write for a future
              instance of yourself joining this session.>",
  "notes": [
    "[REQUIREMENT] ...",
    "[DECISION] ...",
    "[FEEDBACK] ...",
    "[MEASUREMENT] ..."
  ]
}

Rules for notes:
- Each note must start with one of [REQUIREMENT], [DECISION], [FEEDBACK],
  [MEASUREMENT], [TODO].
- Include only information that should outlive this conversation. Skip
  anything already obvious from the current code or from earlier saved
  versions.
- Keep notes one-line each. No code blocks.

Return strictly the JSON. No markdown fences, no commentary.`;

export interface CompactionContext {
  /** Provider-aware so we don't bill the user when local is active. */
  toggles: ChatToggles;
  /** Required when toggles.provider === 'anthropic'. */
  apiKey?: string;
}

export async function proposeCompaction(
  ctx: CompactionContext,
  history: ChatMessage[],
  /** Number of most-recent messages to keep verbatim. Aggressive auto-compaction
   *  passes a small number (2); manual compaction uses the larger default. */
  keepTail: number = DEFAULT_KEEP_TAIL,
): Promise<CompactionProposal> {
  if (history.length <= keepTail) {
    throw new Error('Not enough history to compact yet — chat for a few more turns first.');
  }
  // Pick the keep/drop boundary so the first KEPT message is never a
  // user message carrying `toolResults` — those reference a
  // `tool_use_id` from a preceding `assistant.tool_calls` message which
  // would be in the dropped slice. Both Anthropic and WebLLM reject an
  // orphan tool_result block. We walk forward past every such message;
  // the summary captures what the tool round accomplished.
  let keepStart = history.length - keepTail;
  while (keepStart < history.length && isOrphanToolResultHead(history[keepStart])) {
    keepStart++;
  }
  const keep = history.slice(keepStart);
  const drop = history.slice(0, keepStart);
  if (drop.length === 0) {
    throw new Error('Not enough history to compact yet — chat for a few more turns first.');
  }
  const transcript = drop.map(formatForSummary).join('\n\n');
  const prompt = `Compact this transcript:\n\n${transcript}`;

  let text: string;
  let usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
  let costUsd: number;
  let compactionModel: string;

  const t0 = performance.now();
  try {
    if (ctx.toggles.provider === 'local') {
      if (!ctx.toggles.localModel) throw new Error('Local model required for compaction.');
      compactionModel = ctx.toggles.localModel;
      const r = await summarizeLocal(ctx.toggles.localModel, COMPACTION_SYSTEM, prompt);
      text = r.text;
      usage = { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
      costUsd = 0;
    } else {
      const apiKey = ctx.apiKey ?? (await getKey(ctx.toggles.provider))?.apiKey;
      if (!apiKey) throw new Error(`${ctx.toggles.provider} API key required for compaction.`);
      compactionModel = COMPACTION_MODEL[ctx.toggles.provider];
      const summarizer = ctx.toggles.provider === 'anthropic' ? summarize
        : ctx.toggles.provider === 'openai' ? summarizeOpenai
        : summarizeGemini;
      const r = await summarizer(apiKey, compactionModel, COMPACTION_SYSTEM, prompt);
      text = r.text;
      usage = r.usage;
      costUsd = turnCostUsd(ctx.toggles.provider, compactionModel, usage);
    }
  } catch (err) {
    recordEvent({
      provider: ctx.toggles.provider,
      model: ctx.toggles.provider === 'local' ? (ctx.toggles.localModel ?? '(no model)') : COMPACTION_MODEL[ctx.toggles.provider],
      kind: 'summarize',
      durationMs: Math.round(performance.now() - t0),
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      requestSummary: `${drop.length} drop / ${keep.length} keep`,
    });
    throw err;
  }
  recordEvent({
    provider: ctx.toggles.provider,
    model: compactionModel,
    kind: 'summarize',
    durationMs: Math.round(performance.now() - t0),
    status: 'ok',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cacheReadInputTokens,
    textPreview: text.slice(0, 200),
    requestSummary: `${drop.length} drop / ${keep.length} keep`,
  });

  const parsed = parseProposal(text);
  return {
    summary: parsed.summary,
    proposedNotes: parsed.notes,
    keep,
    drop,
    costUsd,
    usage,
  };
}

/** True for any `user` message carrying `toolResults`. Those blocks
 *  reference a `tool_use_id` from a preceding `assistant.tool_calls`
 *  message; if that assistant message is in the dropped slice (almost
 *  always the case at the boundary) the kept tool_result is orphaned
 *  and the next API turn fails. We accept losing any mixed text/image
 *  content on these messages — in practice the chat loop never produces
 *  mixed tool-result + text messages anyway, and the summary covers what
 *  the tool round accomplished. */
function isOrphanToolResultHead(msg: ChatMessage): boolean {
  return msg.role === 'user' && !!msg.toolResults && msg.toolResults.length > 0;
}

function formatForSummary(msg: ChatMessage): string {
  const lines: string[] = [`[${msg.role}]`];
  for (const b of msg.blocks) {
    if (b.type === 'text') lines.push(b.text);
    else if (b.type === 'image') lines.push(`<image: ${b.source.label ?? 'attachment'}>`);
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      lines.push(`tool: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);
    }
  }
  if (msg.toolResults && msg.toolResults.length > 0) {
    for (const tr of msg.toolResults) {
      const head = tr.content.slice(0, 200);
      lines.push(`result: ${tr.isError ? '[ERROR] ' : ''}${head}`);
    }
  }
  return lines.join('\n');
}

interface ParsedProposal {
  summary: string;
  notes: string[];
}

function parseProposal(text: string): ParsedProposal {
  // Be lenient: strip markdown fences if Haiku adds them despite the rules.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(stripped) as { summary?: string; notes?: unknown };
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n): n is string => typeof n === 'string')
      : [];
    return { summary: typeof parsed.summary === 'string' ? parsed.summary : stripped, notes };
  } catch {
    // Fall back to using the raw text as the summary with no notes.
    return { summary: stripped, notes: [] };
  }
}
