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

import type { ChatMessage, PersistedToolResult } from './types';

/** Appended to an elided tool result's text so the model knows a render it
 *  produced earlier was omitted (and that its stats are still trustworthy). */
export const ELIDED_IMAGE_NOTE =
  '\n\n[An earlier render image was omitted here to conserve context. The geometry stats above remain accurate; call renderView / renderViews again if you need to see it.]';

function hasImage(r: PersistedToolResult): boolean {
  return r.image !== undefined;
}

/**
 * Return a history equivalent to `history` but with all render images except
 * the most-recent `keepLastImages` stripped from tool results. Input is never
 * mutated; when nothing needs trimming the original array is returned as-is.
 */
export function elideStaleToolImages(
  history: ChatMessage[],
  keepLastImages: number,
): ChatMessage[] {
  // Count tool-result images across the whole history.
  let total = 0;
  for (const m of history) {
    if (!m.toolResults) continue;
    for (const r of m.toolResults) if (hasImage(r)) total++;
  }
  // keepLastImages <= 0 means "strip them all"; large values disable trimming.
  if (total <= Math.max(0, keepLastImages)) return history;

  const elideCount = total - Math.max(0, keepLastImages);
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
