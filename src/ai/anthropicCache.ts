// Prompt-cache breakpoints for the Anthropic conversation history. Pure
// (types only from the SDK), so the unit tier can test it without the client.

import type Anthropic from '@anthropic-ai/sdk';
import type { ThinkingLevel } from './types';

/** Prompt-cache lifetime. '5m' is the API default; '1h' costs 2× input to
 *  write (vs 1.25×) but survives a long thinking turn or a pause between
 *  messages, either of which otherwise expires the cache and re-writes the
 *  whole conversation on the next step. */
export type CacheTtl = '5m' | '1h';

/** The cache_control marker for a TTL. '5m' sends the bare marker so a
 *  request without the 1-hour cache is byte-identical to before. */
export function cacheControlFor(ttl: CacheTtl): Anthropic.CacheControlEphemeral {
  return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

/** Which cache lifetime a turn at `thinking` should use. High+ effort turns
 *  routinely think for several minutes — one 5m11s step outlived the default
 *  cache and the next step re-wrote ~160k tokens — so they get the 1-hour
 *  cache when `extendedForDeepThinking` (Advanced settings) is on. */
export function cacheTtlForThinking(thinking: ThinkingLevel | undefined, extendedForDeepThinking: boolean): CacheTtl {
  if (!extendedForDeepThinking) return '5m';
  return thinking === 'high' || thinking === 'xhigh' || thinking === 'max' ? '1h' : '5m';
}

type CacheableBlock = Anthropic.ContentBlockParam & { cache_control?: Anthropic.CacheControlEphemeral | null };

/** Copy of `msg` with an ephemeral cache breakpoint on its last cacheable
 *  block (thinking blocks can't carry one), or null if it has none. */
function withBreakpoint(msg: Anthropic.MessageParam, marker: Anthropic.CacheControlEphemeral): Anthropic.MessageParam | null {
  const blocks: Anthropic.ContentBlockParam[] = typeof msg.content === 'string'
    ? (msg.content.length > 0 ? [{ type: 'text', text: msg.content }] : [])
    : msg.content.slice();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
    blocks[i] = { ...b, cache_control: marker } as CacheableBlock;
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
export function withHistoryCacheBreakpoints(messages: Anthropic.MessageParam[], ttl: CacheTtl = '5m'): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const marker = cacheControlFor(ttl);
  const out = messages.slice();
  const lastIdx = out.length - 1;
  const last = withBreakpoint(out[lastIdx], marker);
  if (last) out[lastIdx] = last;
  for (let i = lastIdx - 1; i >= 0; i--) {
    if (out[i].role !== 'user') continue;
    const prev = withBreakpoint(out[i], marker);
    if (prev) out[i] = prev;
    break;
  }
  return out;
}
