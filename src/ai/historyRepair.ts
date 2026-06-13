// Tool-history repair — the single ChatMessage-level fix for the
// tool_use/tool_result invariant that every hosted provider enforces: an
// assistant message that emitted tool calls MUST be followed by a user message
// carrying a tool_result for every one of those calls, or the next request
// 400s ("tool_use ids were found without tool_result blocks").
//
// The per-provider request builders (anthropic.ts / openai.ts / gemini.ts) each
// repair this transiently for the message array they send, but a corrupted
// *persisted* history keeps tripping the 400 on every turn until the stored
// messages themselves are fixed. This module operates on the persisted
// ChatMessage[] so the repair can be written back to IndexedDB and the chat
// becomes sendable again — the backing logic for the explicit "Repair tool
// history" action and the reliable-rewind guard.
//
// Pure logic (no DOM, no IndexedDB) so it lives in the fast unit tier
// (tests/unit/historyRepair.test.ts). generateId is a pure id factory.

import { generateId } from '../storage/db';
import type { ChatMessage, PersistedToolResult } from './types';

export interface HistoryRepairResult {
  /** The repaired, correctly-ordered message list. New array; untouched
   *  messages are reused by reference. */
  messages: ChatMessage[];
  /** Messages that are new or were mutated and must be re-persisted
   *  (putMessages). */
  toPersist: ChatMessage[];
  /** True when anything was changed (drives "nothing to repair" feedback). */
  changed: boolean;
}

const INTERRUPTED_CONTENT =
  'Tool call did not complete (the turn was interrupted; history was repaired so the chat can continue).';

/** Pair up every orphaned assistant `tool_use` with a synthetic, error-marked
 *  `tool_result` so the persisted history satisfies the provider invariant.
 *
 *  Three shapes are handled:
 *   1. assistant(tool_use) → user(tool_results) missing some/all ids — the
 *      missing results are prepended into that existing user message.
 *   2. assistant(tool_use) → another assistant (the tool_result carrier was
 *      lost entirely) — a synthetic tool_result user message is inserted
 *      between them.
 *   3. assistant(tool_use) at the tail (no following message) — a synthetic
 *      tool_result user message is appended, leaving the chat in a normal
 *      "ready for the model to respond" state (resumable, nothing dropped). */
export function repairToolHistory(history: ChatMessage[]): HistoryRepairResult {
  const messages = [...history];
  const toPersist: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) continue;

    const ids = msg.toolCalls.map(tc => tc.id);
    const next = messages[i + 1];
    const covered = new Set(
      next && next.role === 'user'
        ? (next.toolResults ?? []).map(r => r.toolUseId)
        : [],
    );
    const missing = ids.filter(id => !covered.has(id));
    if (missing.length === 0) continue;

    const synthetic: PersistedToolResult[] = missing.map(id => ({
      toolUseId: id,
      content: INTERRUPTED_CONTENT,
      isError: true,
    }));

    if (next && next.role === 'user') {
      // Case 1: inject the missing results into the existing carrier. Results
      // must lead the block list (providers require tool_result before any
      // user text), so prepend.
      const repaired: ChatMessage = {
        ...next,
        toolResults: [...synthetic, ...(next.toolResults ?? [])],
      };
      messages[i + 1] = repaired;
      toPersist.push(repaired);
    } else {
      // Cases 2 & 3: insert/append a fresh synthetic tool_result user message.
      // Seq sits strictly between the assistant and whatever follows so
      // listMessages' seq-sort keeps the pair adjacent across a reload.
      const seq = next && next.seq > msg.seq ? (msg.seq + next.seq) / 2 : msg.seq + 0.5;
      const inserted: ChatMessage = {
        id: generateId(),
        sessionId: msg.sessionId,
        role: 'user',
        blocks: [],
        toolResults: synthetic,
        createdAt: msg.createdAt + 1,
        seq,
      };
      messages.splice(i + 1, 0, inserted);
      toPersist.push(inserted);
      i++; // skip past the message we just inserted
    }
  }

  return { messages, toPersist, changed: toPersist.length > 0 };
}

/** Cheap predicate: does this history contain an orphaned tool_use that would
 *  make the next provider request fail? Used to conditionally surface the
 *  "Repair tool history" affordance. */
export function hasOrphanedToolCalls(history: ChatMessage[]): boolean {
  return repairToolHistory(history).changed;
}
