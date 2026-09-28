import { describe, expect, it } from 'vitest';
import { carriedAttachments } from '../../src/ai/compactionAttachments';
import type { ChatMessage } from '../../src/ai/types';

const img = (data: string) => ({ type: 'image' as const, source: { data, mediaType: 'image/png' as const } });
const msg = (seq: number, role: 'user' | 'assistant', blocks: ChatMessage['blocks'], extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: String(seq), sessionId: 's', role, blocks, createdAt: seq, seq, ...extra });

describe('carriedAttachments', () => {
  it('keeps user-attached images, newest last, capped and de-duplicated', () => {
    const dropped = [
      msg(1, 'user', [{ type: 'text', text: 'like this' }, img('a'), img('b')]),
      msg(2, 'assistant', [{ type: 'text', text: 'ok' }]),
      msg(3, 'user', [img('c')]),
      msg(4, 'user', [img('a')]), // re-attached later: keep the later copy
    ];
    expect(carriedAttachments(dropped, 10).map(b => b.source.data)).toEqual(['b', 'c', 'a']);
    expect(carriedAttachments(dropped, 2).map(b => b.source.data)).toEqual(['c', 'a']);
    expect(carriedAttachments(dropped, 0)).toEqual([]);
  });

  it('ignores the agent\'s render screenshots (tool results) — it can re-render', () => {
    const dropped = [msg(1, 'user', [], { toolResults: [{ toolUseId: 't', content: 'ok', image: { data: 'r', mediaType: 'image/png' } }] })];
    expect(carriedAttachments(dropped, 4)).toEqual([]);
  });
});
