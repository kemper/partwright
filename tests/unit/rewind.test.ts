import { describe, expect, it } from 'vitest';
import { repairToolHistory } from '../../src/ai/historyRepair';
import {
  countChapters, countSteps, isChapterStart, isStepStart, mergeBySeq,
  repairUndo, rewindCutIndex, takeFirstStep,
} from '../../src/ai/rewind';
import type { ChatMessage } from '../../src/ai/types';

let seq = 0;
function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  const s = seq++;
  return { id: `m${s}`, sessionId: 's', blocks: [], createdAt: s, seq: s, ...partial };
}
const text = (t: string) => [{ type: 'text' as const, text: t }];
const typed = (t: string) => msg({ role: 'user', blocks: text(t) });
const callTool = (id: string) => msg({ role: 'assistant', blocks: text('working'), toolCalls: [{ id, name: 'runAndSave', input: {} }] });
const results = (id: string, extra: Partial<ChatMessage> = {}) =>
  msg({ role: 'user', toolResults: [{ toolUseId: id, content: 'ok' }], ...extra });
const reply = (t: string) => msg({ role: 'assistant', blocks: text(t) });

/** A plan approval followed by a three-step agent run that ends in an error. */
function longRun(): ChatMessage[] {
  seq = 0;
  return [
    typed('make a bracket'),        // 0  chapter
    reply('here is the plan'),      // 1
    typed('Plan approved'),         // 2  chapter
    callTool('t1'), results('t1'),  // 3,4
    callTool('t2'), results('t2'),  // 5,6
    callTool('t3'), results('t3'),  // 7,8
    msg({ role: 'assistant', blocks: text('boom'), errored: true }), // 9 ephemeral
  ];
}

describe('step / chapter boundaries', () => {
  it('assistant messages and typed prompts start steps; carriers do not', () => {
    seq = 0;
    expect(isStepStart(typed('hi'))).toBe(true);
    expect(isStepStart(callTool('a'))).toBe(true);
    expect(isStepStart(results('a'))).toBe(false);
    expect(isStepStart(msg({ role: 'assistant', blocks: text('x'), errored: true }))).toBe(false);
    expect(isStepStart(msg({ role: 'assistant', blocks: text('sum'), compacted: true }))).toBe(false);
  });

  it('chapters start at human-written messages, incl. a follow-up queued on a carrier, but not nudges', () => {
    seq = 0;
    expect(isChapterStart(typed('hi'))).toBe(true);
    expect(isChapterStart(results('a', { blocks: text('also do X') }))).toBe(true);
    expect(isChapterStart(results('a'))).toBe(false);
    expect(isChapterStart(msg({ role: 'user', blocks: text('continue'), autoResumeNudge: true }))).toBe(false);
    expect(isChapterStart(reply('x'))).toBe(false);
  });
});

describe('rewindCutIndex', () => {
  it('step back removes only the last agent step (and the error bubble after it)', () => {
    const h = longRun();
    expect(rewindCutIndex(h, 'step')).toBe(7);
  });

  it('skip back cuts to before the last human message (the old behavior)', () => {
    const h = longRun();
    expect(rewindCutIndex(h, 'chapter')).toBe(2);
  });

  it('repeated step backs walk back one step at a time', () => {
    const h = longRun();
    const cuts: number[] = [];
    let cur = h;
    for (;;) {
      const c = rewindCutIndex(cur, 'step');
      if (c < 0) break;
      cuts.push(c);
      cur = cur.slice(0, c);
    }
    expect(cuts).toEqual([7, 5, 3, 2, 1, 0]);
  });

  it('never cuts into a compaction summary', () => {
    seq = 0;
    const h = [
      msg({ role: 'user', blocks: text('carried refs') }),
      msg({ role: 'assistant', blocks: text('summary'), compacted: true }),
      reply('kept'),
    ];
    expect(rewindCutIndex(h, 'step')).toBe(2);
    expect(rewindCutIndex(h, 'chapter')).toBe(-1);
    expect(rewindCutIndex(h.slice(0, 2), 'step')).toBe(-1);
  });

  it('returns -1 on an empty history', () => {
    expect(rewindCutIndex([], 'step')).toBe(-1);
    expect(rewindCutIndex([], 'chapter')).toBe(-1);
  });
});

describe('takeFirstStep / counts', () => {
  it('a step is an assistant message plus its tool-result carrier', () => {
    const h = longRun();
    const slice = h.slice(2, 9);
    expect(countSteps(slice)).toBe(4);
    expect(countChapters(slice)).toBe(1);
    const first = takeFirstStep(slice);
    expect(first.step.map(m => m.id)).toEqual(['m2']);
    const second = takeFirstStep(first.rest);
    expect(second.step.map(m => m.id)).toEqual(['m3', 'm4']);
  });

  it('a slice that starts on a carrier restores the carrier on its own', () => {
    seq = 0;
    const slice = [results('a', { blocks: text('also X') }), callTool('b'), results('b')];
    expect(takeFirstStep(slice).step).toHaveLength(1);
    expect(countSteps(slice)).toBe(2);
  });
});

describe('mergeBySeq', () => {
  it('inserts by seq and replaces by id', () => {
    const h = longRun();
    const without = h.filter((_, i) => i !== 4);
    const merged = mergeBySeq(without, [h[4]]);
    expect(merged.map(m => m.id)).toEqual(h.map(m => m.id));
    const changed = { ...h[1], blocks: text('edited') };
    expect(mergeBySeq(h, [changed])[1]).toBe(changed);
  });
});

describe('repairUndo', () => {
  it('reverses the repair a chapter cut at a queued follow-up triggers', () => {
    seq = 0;
    const before = [
      typed('go'),
      callTool('t1'),
      results('t1', { blocks: text('also make it blue') }), // chapter start on a carrier
      callTool('t2'),
      results('t2'),
    ];
    const cut = rewindCutIndex(before, 'chapter');
    expect(cut).toBe(2);
    const kept = before.slice(0, cut);
    const removed = before.slice(cut);
    const repair = repairToolHistory(kept);
    expect(repair.changed).toBe(true); // t1 is orphaned → synthetic carrier appended
    const undo = repairUndo(kept, repair)!;
    expect(undo.removeIds).toHaveLength(1);

    // Step forward: undo the repair, then restore the first step.
    const gone = new Set(undo.removeIds);
    let h = mergeBySeq(repair.messages.filter(m => !gone.has(m.id)), undo.restore);
    const { step, rest } = takeFirstStep(removed);
    h = mergeBySeq(h, step);
    h = mergeBySeq(h, rest);
    expect(h).toEqual(before);
    expect(repairToolHistory(h).changed).toBe(false);
  });

  it('is undefined when the repair changed nothing', () => {
    const h = longRun().slice(0, 7);
    expect(repairUndo(h, repairToolHistory(h))).toBeUndefined();
  });
});
