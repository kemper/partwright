import { describe, it, expect } from 'vitest';
import { repairToolHistory, hasOrphanedToolCalls, isToolHistoryMismatchError } from '../../src/ai/historyRepair';
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

  describe('orphaned tool_results (the compaction case)', () => {
    it('removes a tool_result whose tool_use was dropped, deleting the empty carrier', () => {
      // What compaction strands: a summary turn replaced the assistant(tool_use)
      // but the tool_result carrier survived in the kept tail.
      const history = [assistant(0, [], '[compacted summary]'), toolResults(1, ['gone']), userText(2, 'continue')];
      expect(hasOrphanedToolCalls(history)).toBe(true);
      const r = repairToolHistory(history);
      expect(r.changed).toBe(true);
      expect(r.toDelete).toHaveLength(1);
      expect(r.toDelete[0].id).toBe('r1');
      // The orphan is gone; nothing else disturbed.
      expect(r.messages.map(m => m.id)).toEqual(['a0', 'u2']);
      expect(hasOrphanedToolCalls(r.messages)).toBe(false);
    });

    it('strips only the orphaned ids from a carrier that also has a valid result', () => {
      // A multi-call turn split by compaction: t1's call was dropped, t2's kept.
      const history = [assistant(0, ['t2']), toolResults(1, ['t1', 't2'])];
      const r = repairToolHistory(history);
      expect(r.changed).toBe(true);
      expect(r.toDelete).toHaveLength(0);
      const carrier = r.messages[1];
      const ids = carrier.toolResults!.map(x => x.toolUseId);
      expect(ids).toEqual(['t2']);
      expect(r.toPersist.map(m => m.id)).toContain('r1');
    });

    it('keeps a carrier that has text alongside the orphaned result', () => {
      const carrier: ChatMessage = {
        id: 'm1', sessionId: 's', role: 'user',
        blocks: [{ type: 'text', text: 'thanks' }],
        toolResults: [{ toolUseId: 'gone', content: 'ok', isError: false }],
        createdAt: 1000, seq: 1,
      };
      const r = repairToolHistory([userText(0, 'hi'), carrier]);
      expect(r.changed).toBe(true);
      expect(r.toDelete).toHaveLength(0);
      const repaired = r.messages.find(m => m.id === 'm1')!;
      expect(repaired.toolResults).toHaveLength(0);
      expect(repaired.blocks[0]).toEqual({ type: 'text', text: 'thanks' });
    });

    it('does not flag a valid result whose tool_use lives anywhere in history', () => {
      const history = [assistant(0, ['t1']), toolResults(1, ['t1']), userText(2, 'ok')];
      const r = repairToolHistory(history);
      expect(r.changed).toBe(false);
      expect(r.toDelete).toHaveLength(0);
    });
  });
});

describe('isToolHistoryMismatchError', () => {
  it('matches the Anthropic orphaned-tool_use 400 (the reported error)', () => {
    const msg =
      'OpenAI 400: {"type":"error","error":{"type":"invalid_request_error","message":"messages.28: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01Cvxc2x4mLvUKaYTaCQK32e. Each `tool_use` block must have a corresponding `tool_result` block in the next message."}}';
    expect(isToolHistoryMismatchError(msg)).toBe(true);
  });

  it('matches the Anthropic orphaned-tool_result 400', () => {
    expect(isToolHistoryMismatchError('400: unexpected `tool_use_id` found in `tool_result` blocks')).toBe(true);
  });

  it('matches the OpenAI unanswered-tool_calls 400', () => {
    expect(
      isToolHistoryMismatchError(
        "OpenAI 400: An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_abc",
      ),
    ).toBe(true);
  });

  it("matches the OpenAI orphaned-tool-message 400", () => {
    expect(
      isToolHistoryMismatchError(
        "Invalid parameter: messages with role 'tool' must be a response to a preceding message with 'tool_calls'.",
      ),
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isToolHistoryMismatchError('401: Invalid API key.')).toBe(false);
    expect(isToolHistoryMismatchError('Rate limit exceeded, please retry.')).toBe(false);
    expect(isToolHistoryMismatchError('The model returned an empty response.')).toBe(false);
    expect(isToolHistoryMismatchError('')).toBe(false);
  });
});
