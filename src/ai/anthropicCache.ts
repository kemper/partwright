// Prompt-cache breakpoints for the Anthropic conversation history. Pure
// (types only from the SDK), so the unit tier can test it without the client.

import type Anthropic from '@anthropic-ai/sdk';

type CacheableBlock = Anthropic.ContentBlockParam & { cache_control?: Anthropic.CacheControlEphemeral | null };

/** Copy of `msg` with an ephemeral cache breakpoint on its last cacheable
 *  block (thinking blocks can't carry one), or null if it has none. */
function withBreakpoint(msg: Anthropic.MessageParam): Anthropic.MessageParam | null {
  const blocks: Anthropic.ContentBlockParam[] = typeof msg.content === 'string'
    ? (msg.content.length > 0 ? [{ type: 'text', text: msg.content }] : [])
    : msg.content.slice();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
    blocks[i] = { ...b, cache_control: { type: 'ephemeral' } } as CacheableBlock;
    return { ...msg, content: blocks };
  }
  return null;
}

/** Cache the conversation history. Every agent step re-sends the whole
 *  conversation; without a breakpoint in `messages` only the system prompt
 *  and tools are cached, so the history bills at full input price each time.
 *  Two breakpoints (Anthropic allows four; system + tools use two):
 *  - the LAST message — writes the cache for the next step to read;
 *  - the previous USER message — exactly where the previous request put its
 *    breakpoint, so the read hits even when this step appended more than the
 *    API's ~20-block lookback (a wide parallel-tool turn).
 *  Pure: returns a new array; untouched messages are shared. */
export function withHistoryCacheBreakpoints(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const lastIdx = out.length - 1;
  const last = withBreakpoint(out[lastIdx]);
  if (last) out[lastIdx] = last;
  for (let i = lastIdx - 1; i >= 0; i--) {
    if (out[i].role !== 'user') continue;
    const prev = withBreakpoint(out[i]);
    if (prev) out[i] = prev;
    break;
  }
  return out;
}
