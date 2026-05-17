// Manual compaction. The user clicks "Compact" → we ask Haiku to (a)
// summarize the transcript and (b) propose session notes worth promoting
// into the durable session log. The user reviews the proposal in a confirm
// modal; on accept, the chat history collapses to a single summary block +
// the most recent N turns, and the proposed notes are written to
// window.partwright.addSessionNote so they survive future compactions.

import { summarize } from './anthropic';
import type { ChatMessage } from './types';

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

const KEEP_TAIL = 4;

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

export async function proposeCompaction(
  apiKey: string,
  history: ChatMessage[],
): Promise<CompactionProposal> {
  if (history.length <= KEEP_TAIL) {
    throw new Error('Not enough history to compact yet — chat for a few more turns first.');
  }
  const keep = history.slice(-KEEP_TAIL);
  const drop = history.slice(0, history.length - KEEP_TAIL);
  const transcript = drop.map(formatForSummary).join('\n\n');

  const { text, usage } = await summarize(
    apiKey,
    'claude-haiku-4-5',
    COMPACTION_SYSTEM,
    `Compact this transcript:\n\n${transcript}`,
  );

  const parsed = parseProposal(text);
  const costUsd = (usage.inputTokens * 1.0 + usage.outputTokens * 5.0) / 1_000_000;
  return {
    summary: parsed.summary,
    proposedNotes: parsed.notes,
    keep,
    drop,
    costUsd,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
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
