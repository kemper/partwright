// Manual compaction. The user clicks "Compact" → we ask Haiku to (a)
// summarize the transcript and (b) propose session notes worth promoting
// into the durable session log. The user reviews the proposal in a confirm
// modal; on accept, the chat history collapses to a single summary block +
// the most recent N turns, and the proposed notes are written to
// window.partwright.addSessionNote so they survive future compactions.

import { summarize } from './anthropic';
import { summarizeLocal } from './local';
import type { ChatMessage, ChatToggles } from './types';

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
  // Pick the keep/drop boundary so the first KEPT message is never an
  // orphan `user.toolResults` — that would dangle without its matching
  // `assistant.tool_calls`, which both Anthropic and WebLLM reject. We
  // walk the boundary forward (dropping more) until the kept head is
  // either a user message with text/images, an assistant message, or
  // we've emptied the keep set entirely.
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
  let usage: { inputTokens: number; outputTokens: number };
  let costUsd: number;

  if (ctx.toggles.provider === 'anthropic') {
    if (!ctx.apiKey) throw new Error('Anthropic API key required for compaction.');
    const r = await summarize(ctx.apiKey, 'claude-haiku-4-5', COMPACTION_SYSTEM, prompt);
    text = r.text;
    usage = { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens };
    costUsd = (usage.inputTokens * 1.0 + usage.outputTokens * 5.0) / 1_000_000;
  } else {
    if (!ctx.toggles.localModel) throw new Error('Local model required for compaction.');
    const r = await summarizeLocal(ctx.toggles.localModel, COMPACTION_SYSTEM, prompt);
    text = r.text;
    usage = { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens };
    costUsd = 0;
  }

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

/** True for a `user` message whose content is JUST a tool-result payload —
 *  i.e. the continuation of a previous tool round. These rely on the
 *  preceding `assistant.tool_calls` for context and break when isolated. */
function isOrphanToolResultHead(msg: ChatMessage): boolean {
  if (msg.role !== 'user') return false;
  if (!msg.toolResults || msg.toolResults.length === 0) return false;
  // If the user also typed text or attached an image, treat as a normal
  // user turn — the model can still interpret it standalone.
  const hasNonToolContent = msg.blocks.some(b =>
    (b.type === 'text' && b.text.trim().length > 0) || b.type === 'image'
  );
  return !hasNonToolContent;
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
