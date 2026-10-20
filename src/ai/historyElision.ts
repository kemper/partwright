// Trim stale render images out of the history sent to a provider.
//
// renderView / renderViews / runIsolated return PNG snapshots that are
// persisted on the tool result (`PersistedToolResult.image`) so the on-screen
// transcript shows the agent what it saw. But every persisted image is re-sent
// to the provider on EVERY subsequent turn, so a long modeling session's image
// tokens compound — the same problem the CLI solves with the disposable
// `model-sculpt` subagent (see CLAUDE.md). The in-app agent rarely needs to
// re-see a render from ten turns ago: it already extracted what it needed into
// the text stats, which stay. So we keep only the most-recent N render images
// in the provider request and replace the older ones with a short text stub.
//
// This is a pure transform over a COPY of the history. The persisted history
// (IndexedDB) and the rendered transcript are untouched — only the bytes that
// go out on the wire are trimmed. Dropping the optional `image` field from a
// tool result never breaks API turn structure (every provider treats the image
// as optional alongside the required text content), so this is provider-
// agnostic and applies at the single streamTurn call site.

import type { ChatMessage, PersistedToolResult, Provider } from './types';

/** Whether `provider` caches the repeated conversation prefix, so trimming
 *  should be stepped (cache-friendly) rather than sliding. OpenAI and Gemini
 *  cache automatically; Anthropic does when history caching is enabled
 *  (anthropic.ts adds the breakpoint). Custom endpoints and local models get
 *  no dependable discount, so they keep the tight sliding window. */
export function providerCachesHistory(provider: Provider, anthropicHistoryCaching: boolean): boolean {
  if (provider === 'anthropic') return anthropicHistoryCaching;
  return provider === 'openai' || provider === 'gemini';
}

/** Appended to an elided tool result's text so the model knows a render it
 *  produced earlier was omitted (and that its stats are still trustworthy). */
export const ELIDED_IMAGE_NOTE =
  '\n\n[An earlier render image was omitted here to conserve context. The geometry stats above remain accurate; call renderView / renderViews again if you need to see it.]';

function hasImage(r: PersistedToolResult): boolean {
  return r.image !== undefined;
}

/**
 * How many of `total` images (oldest first) to strip.
 *
 * Sliding (`trimTo` omitted or ≥ `maxImages`): keep exactly the newest
 * `maxImages`, so every new render drops one old image.
 *
 * Stepped (`trimTo` < `maxImages`): let images accumulate up to `maxImages`,
 * then cut back to `trimTo` in one go. Stateless — derived from `total` alone,
 * so the chat loop recomputes it each iteration and gets the same answer. The
 * point is prompt caching: stripping an image edits an earlier message, which
 * invalidates the provider's cached prefix from that point on. A sliding
 * window edits history on every render; stepping edits it once per
 * (maxImages − trimTo + 1) renders, so the cached history stays valid between
 * cuts. The kept count cycles trimTo … maxImages.
 */
export function imagesToElide(total: number, maxImages: number, trimTo?: number): number {
  const max = Math.max(0, maxImages);
  if (total <= max) return 0;
  // Never trim below one image (unless the caller keeps none at all): the
  // render the model just asked for must survive the cut.
  const floor = trimTo === undefined ? max : Math.min(max, Math.max(max > 0 ? 1 : 0, trimTo));
  const period = max - floor + 1;
  return period * Math.ceil((total - max) / period);
}

/**
 * Return a history equivalent to `history` but with stale render images
 * stripped from tool results (see `imagesToElide` for sliding vs stepped).
 * Input is never mutated; when nothing needs trimming the original array is
 * returned as-is.
 */
export function elideStaleToolImages(
  history: ChatMessage[],
  keepLastImages: number,
  trimTo?: number,
): ChatMessage[] {
  // Count tool-result images across the whole history.
  let total = 0;
  for (const m of history) {
    if (!m.toolResults) continue;
    for (const r of m.toolResults) if (hasImage(r)) total++;
  }
  // keepLastImages <= 0 means "strip them all"; large values disable trimming.
  const elideCount = imagesToElide(total, keepLastImages, trimTo);
  if (elideCount === 0) return history;
  let seen = 0; // images encountered so far, oldest-first

  return history.map((m): ChatMessage => {
    if (!m.toolResults || !m.toolResults.some(hasImage)) return m;
    const toolResults = m.toolResults.map((r): PersistedToolResult => {
      if (!hasImage(r)) return r;
      const isStale = seen < elideCount;
      seen++;
      if (!isStale) return r;
      // Strip the image; annotate the text once (idempotent on re-runs).
      const { image: _omit, ...rest } = r;
      const content = rest.content.endsWith(ELIDED_IMAGE_NOTE)
        ? rest.content
        : rest.content + ELIDED_IMAGE_NOTE;
      return { ...rest, content };
    });
    return { ...m, toolResults };
  });
}
