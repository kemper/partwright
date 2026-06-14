import { describe, it, expect } from 'vitest';
import { repairToolHistory, hasOrphanedToolCalls } from '../../src/ai/historyRepair';
import type { ChatMessage } from '../../src/ai/types';

function assistant(seq: number, toolCallIds: string[], text = ''): ChatMessage {
  return {
    id: `a${seq}`,
    sessionId: 's',
    role: 'assistant',
    blocks: text ? [{ type: 'text', text }] : [],
    toolCalls: toolCallIds.map(id => ({ id, name: 'runAndSave', input: {} })),
    createdAt: seq * 1000,
    seq,
  };
}

function toolResults(seq: number, ids: string[]): ChatMessage {
  return {
    id: `r${seq}`,
    sessionId: 's',
    role: 'user',
    blocks: [],
    toolResults: ids.map(id => ({ toolUseId: id, content: 'ok', isError: false })),
    createdAt: seq * 1000,
    seq,
  };
}

function userText(seq: number, text: string): ChatMessage {
  return { id: `u${seq}`, sessionId: 's', role: 'user', blocks: [{ type: 'text', text }], createdAt: seq * 1000, seq };
}

describe('repairToolHistory', () => {
  it('leaves a correctly-paired history untouched', () => {
    const history = [userText(0, 'hi'), assistant(1, ['t1']), toolResults(2, ['t1'])];
    const r = repairToolHistory(history);
    expect(r.changed).toBe(false);
    expect(r.toPersist).toHaveLength(0);
    expect(r.messages).toEqual(history);
  });

  it('appends a synthetic result for a trailing orphaned tool_use', () => {
    const history = [userText(0, 'hi'), assistant(1, ['t1'], 'working on it')];
    const r = repairToolHistory(history);
    expect(r.changed).toBe(true);
    expect(r.toPersist).toHaveLength(1);
    const inserted = r.messages[2];
    expect(inserted.role).toBe('user');
    expect(inserted.toolResults).toHaveLength(1);
    expect(inserted.toolResults![0]).toMatchObject({ toolUseId: 't1', isError: true });
    // The assistant's text is preserved (nothing dropped).
    expect(r.messages[1].blocks[0]).toEqual({ type: 'text', text: 'working on it' });
    // Seq keeps the pair adjacent on reload.
    expect(inserted.seq).toBeGreaterThan(1);
    expect(inserted.seq).toBeLessThan(2);
  });

  it('injects only the MISSING results into a partial carrier', () => {
    const history = [
      userText(0, 'hi'),
      assistant(1, ['t1', 't2']),
      toolResults(2, ['t2']), // t1 missing
    ];
    const r = repairToolHistory(history);
    expect(r.changed).toBe(true);
    const carrier = r.messages[2];
    const ids = carrier.toolResults!.map(x => x.toolUseId);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    // The synthetic (t1) is prepended so results lead the block list.
    expect(carrier.toolResults![0].toolUseId).toBe('t1');
    expect(carrier.toolResults![0].isError).toBe(true);
  });

  it('inserts a synthetic carrier when the tool_result message was lost entirely', () => {
    // assistant(tool_use) followed directly by another assistant turn.
    const history = [userText(0, 'hi'), assistant(1, ['t1']), assistant(2, [], 'next')];
    const r = repairToolHistory(history);
    expect(r.changed).toBe(true);
    expect(r.messages).toHaveLength(4);
    expect(r.messages[2].role).toBe('user');
    expect(r.messages[2].toolResults![0]).toMatchObject({ toolUseId: 't1', isError: true });
    expect(r.messages[2].seq).toBeGreaterThan(1);
    expect(r.messages[2].seq).toBeLessThan(2);
  });

  it('repairs a mid-history orphan (the unrecoverable-400 case)', () => {
    const history = [
      userText(0, 'first'),
      assistant(1, ['t1']),
      // tool_result for t1 lost; conversation continued with a new user turn
      userText(2, 'second'),
      assistant(3, ['t2']),
      toolResults(4, ['t2']),
    ];
    expect(hasOrphanedToolCalls(history)).toBe(true);
    const r = repairToolHistory(history);
    expect(r.changed).toBe(true);
    // After repair there must be no orphan left.
    expect(hasOrphanedToolCalls(r.messages)).toBe(false);
  });

  it('hasOrphanedToolCalls is false for a clean history', () => {
    const history = [userText(0, 'hi'), assistant(1, ['t1']), toolResults(2, ['t1'])];
    expect(hasOrphanedToolCalls(history)).toBe(false);
  });
});
