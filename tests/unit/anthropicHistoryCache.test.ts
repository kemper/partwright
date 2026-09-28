import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { withHistoryCacheBreakpoints } from '../../src/ai/anthropic';

type Msg = Anthropic.MessageParam;
const marked = (m: Msg) => Array.isArray(m.content)
  ? m.content.map(b => ('cache_control' in b && b.cache_control ? 'C' : '-')).join('')
  : 'string';

describe('withHistoryCacheBreakpoints', () => {
  it('marks the last message and the previous user message, leaving the input untouched', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool_use', id: 't1', name: 'run', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'run', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }, { type: 'text', text: 'more' }] },
    ];
    const snapshot = JSON.stringify(msgs);
    const out = withHistoryCacheBreakpoints(msgs);
    expect(JSON.stringify(msgs)).toBe(snapshot);
    expect(out.map(marked)).toEqual(['string', '--', 'C', '-', '-C']);
  });

  it('turns a string-content last message into a marked text block', () => {
    const out = withHistoryCacheBreakpoints([{ role: 'user', content: 'hi' }]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }]);
  });

  it('never marks a thinking block', () => {
    const out = withHistoryCacheBreakpoints([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'thinking', thinking: 't', signature: 's' }] },
    ]);
    expect(marked(out[1])).toBe('C-');
  });
});
