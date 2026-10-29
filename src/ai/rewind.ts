// Chat rewind — the pure history math behind the AI panel's transport controls
// (step back / step forward / skip back / skip forward).
//
// Two granularities:
//   - a STEP is one model request/response cycle: an assistant message plus
//     the tool-result carrier that answers it, or a single user-authored
//     message (a typed prompt, a plan approval, an auto-continue nudge). Step
//     back peels exactly one of these off the end, so a step that failed on an
//     error can be undone without losing the rest of the run.
//   - a CHAPTER starts at each message the human wrote (incl. a follow-up they
//     queued mid-run, which rides on a tool-result carrier). Skip back cuts to
//     before the latest one — the coarse "undo my last request" jump.
//
// Every cut lands on a step boundary, so a step-back never orphans a tool_use.
// A chapter cut at a queued follow-up can, and the panel's tool-history repair
// then patches the tail; `repairUndo` records how to reverse that patch so a
// later step forward restores the history byte-for-byte.
//
// Pure logic (no DOM, no IndexedDB) — unit-tested in tests/unit/rewind.test.ts.

import type { HistoryRepairResult } from './historyRepair';
import type { ChatMessage } from './types';

export type RewindKind = 'step' | 'chapter';

/** What it takes to reverse a tool-history repair that ran right after a cut:
 *  messages to put back as they were, and repair-inserted ids to delete. */
export interface RepairUndo {
  restore: ChatMessage[];
  removeIds: string[];
}

/** One rewind operation's removed slice (persisted messages only, seq order),
 *  plus the undo for any repair the cut triggered. */
export interface RewindEntry {
  messages: ChatMessage[];
  undo?: RepairUndo;
}

/** The red error bubble / amber stop notice — in-memory only, never persisted,
 *  so they are dropped (not restored) when the slice they sit in is rewound. */
export function isEphemeralMessage(m: ChatMessage): boolean {
  return m.errored === true || m.stopNotice !== undefined;
}

/** Does a step begin at this message? Every model response does; so does a
 *  user-authored message that isn't a tool-result carrier (a carrier belongs
 *  to the assistant step whose calls it answers). */
export function isStepStart(m: ChatMessage): boolean {
  if (isEphemeralMessage(m) || m.compacted) return false;
  if (m.role === 'assistant') return true;
  return m.blocks.length > 0 && !(m.toolResults && m.toolResults.length > 0);
}

/** Does a chapter begin at this message? Anything the human wrote — a typed
 *  prompt, a plan approval, a follow-up queued mid-run — but not the synthetic
 *  auto-continue nudge. */
export function isChapterStart(m: ChatMessage): boolean {
  return m.role === 'user' && !isEphemeralMessage(m) && !m.compacted
    && m.blocks.length > 0 && m.autoResumeNudge !== true;
}

/** Index of the earliest message a rewind may remove: everything up to and
 *  including the last compaction summary (and the carried-attachments note in
 *  front of it) is the conversation's floor — rewinding past it would delete
 *  the summary of turns that no longer exist. */
function rewindFloor(history: ChatMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].compacted) return i + 1;
  }
  return 0;
}

/** Where a rewind of `kind` cuts `history` (everything from the returned index
 *  on is removed), or -1 when there's nothing to rewind. */
export function rewindCutIndex(history: ChatMessage[], kind: RewindKind): number {
  const isStart = kind === 'step' ? isStepStart : isChapterStart;
  const floor = rewindFloor(history);
  for (let i = history.length - 1; i >= floor; i--) {
    if (isStart(history[i])) return i;
  }
  return -1;
}

/** Split a rewound slice into its first step and the rest. The first message
 *  always opens the step (it may be a carrier when a chapter cut landed on a
 *  queued follow-up); the step runs until the next step start. */
export function takeFirstStep(messages: ChatMessage[]): { step: ChatMessage[]; rest: ChatMessage[] } {
  let end = 1;
  while (end < messages.length && !isStepStart(messages[end])) end++;
  return { step: messages.slice(0, end), rest: messages.slice(end) };
}

/** Number of steps in a rewound slice (its first message always counts). */
export function countSteps(messages: ChatMessage[]): number {
  let n = 0;
  messages.forEach((m, i) => { if (i === 0 || isStepStart(m)) n++; });
  return n;
}

/** Number of human-written messages in a rewound slice. */
export function countChapters(messages: ChatMessage[]): number {
  return messages.filter(isChapterStart).length;
}

/** Merge `msgs` into `history` in seq order, replacing any message with the
 *  same id in place. Returns a new array. */
export function mergeBySeq(history: ChatMessage[], msgs: ChatMessage[]): ChatMessage[] {
  const out = [...history];
  for (const msg of msgs) {
    const existing = out.findIndex(m => m.id === msg.id);
    if (existing >= 0) { out[existing] = msg; continue; }
    const insertAt = out.findIndex(m => m.seq > msg.seq);
    if (insertAt === -1) out.push(msg);
    else out.splice(insertAt, 0, msg);
  }
  return out;
}

/** How to reverse `repair` (computed on `before`): messages it modified or
 *  deleted come back as they were; messages it created are removed. Returns
 *  undefined when the repair changed nothing. */
export function repairUndo(before: ChatMessage[], repair: HistoryRepairResult): RepairUndo | undefined {
  if (!repair.changed) return undefined;
  const byId = new Map(before.map(m => [m.id, m]));
  const restore: ChatMessage[] = [];
  const removeIds: string[] = [];
  for (const m of repair.toPersist) {
    const original = byId.get(m.id);
    if (original) restore.push(original);
    else removeIds.push(m.id);
  }
  for (const m of repair.toDelete) {
    const original = byId.get(m.id);
    if (original) restore.push(original);
  }
  return { restore, removeIds };
}
