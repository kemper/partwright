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

import type { ChatMessage, PersistedToolCall, PersistedToolResult, Provider } from './types';

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

// === Stale tool payloads ===
//
// The same send-time-only treatment for text payloads that a later step made
// dead weight (the idea behind OpenCode's dynamic-context-pruning plugin,
// fitted to Partwright's tools):
//   - superseded code: every runAndSave / setCode / runCode … carries the
//     whole program, so an N-step modeling loop re-sends N versions of it on
//     every request. Only the newest `keepRecentCodeBodies` survive; getCode
//     results count as code bodies too.
//   - repeated docs: a readDoc result is dropped when the same doc is read
//     again later (some subdocs are ~30k tokens).
//   - failed calls: once `failedCallInputTurns` newer assistant turns have
//     passed, the large inputs of a call that errored are dropped. Its error
//     message (what the model learned from) stays.
//
// Prompt caching: superseded code and failed inputs are edited a step or a
// few turns behind the tail, so the cached prefix before them survives; a
// dedupe edits further back but only once per repeated read, which pays for
// itself the moment the duplicate would have been re-sent.
//
// Gemini signs function calls (`thoughtSignature`) and rejects tampered
// ones, so a signed call's input is never rewritten (its tool RESULT may
// still be).

/** Tools whose `code` argument is a complete program. */
const CODE_TOOLS = new Set(['setCode', 'runCode', 'runAndSave', 'runIsolated', 'forkVersion', 'runAndAssert', 'runAndExplain']);

export const SUPERSEDED_CODE_NOTE = '[code omitted from context: a later edit or read superseded it. Call getCode for the current source.]';
export const SUPERSEDED_GETCODE_NOTE = '[getCode result omitted from context: a later edit or read superseded it. Call getCode for the current source.]';
export const REPEATED_DOC_NOTE = '[doc omitted from context: the same readDoc call appears again later in this conversation.]';
export const FAILED_INPUT_NOTE = '[omitted from context: input of a failed call]';

export interface ToolPayloadPruneOptions {
  /** Newest code bodies kept verbatim (minimum 1). */
  keepRecentCodeBodies: number;
  /** Assistant turns after which a failed call's large inputs go. */
  failedCallInputTurns: number;
  /** Only failed inputs at least this long (JSON chars) are dropped. */
  failedCallInputMinChars: number;
}

/** Code bodies are counted per target object, so editing one object never
 *  drops the last copy of another's code. */
function codeKey(input: Record<string, unknown>): string {
  return typeof input.object === 'string' ? input.object : '';
}

/** Drop each large top-level value, keeping the keys so the call still
 *  reads as what it was. */
function stubLargeInputs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = JSON.stringify(v ?? null).length > 200 ? FAILED_INPUT_NOTE : v;
  }
  return out;
}

/**
 * Return a history equivalent to `history` with superseded code bodies,
 * repeated doc reads and stale failed-call inputs replaced by short notes.
 * Input is never mutated; when nothing qualifies the original array is
 * returned as-is.
 */
export function pruneStaleToolPayloads(history: ChatMessage[], opts: ToolPayloadPruneOptions): ChatMessage[] {
  const keep = Math.max(1, Math.floor(opts.keepRecentCodeBodies));
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const failed = new Set<string>();
  for (const m of history) {
    for (const tc of m.toolCalls ?? []) calls.set(tc.id, { name: tc.name, input: tc.input ?? {} });
    for (const r of m.toolResults ?? []) if (r.isError) failed.add(r.toolUseId);
  }

  // Code bodies newest-first: a code-tool call's `code`, or a getCode result.
  type Body = { msg: number; id: string; kind: 'input' | 'result'; signed: boolean };
  const bodies = new Map<string, Body[]>();
  const docReads = new Map<string, number>(); // readDoc input key → newest msg index
  const stubCode = new Set<string>();          // `${msg}:${id}:${kind}`
  const stubDoc = new Set<string>();           // `${msg}:${toolUseId}`
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    for (const r of m.toolResults ?? []) {
      const call = calls.get(r.toolUseId);
      if (!call) continue;
      if (call.name === 'getCode' && !r.isError) {
        const list = bodies.get(codeKey(call.input)) ?? [];
        list.push({ msg: i, id: r.toolUseId, kind: 'result', signed: false });
        bodies.set(codeKey(call.input), list);
      } else if (call.name === 'readDoc' && !r.isError) {
        const key = JSON.stringify(call.input);
        if (docReads.has(key)) stubDoc.add(`${i}:${r.toolUseId}`);
        else docReads.set(key, i);
      }
    }
    for (const tc of m.toolCalls ?? []) {
      if (!CODE_TOOLS.has(tc.name) || typeof tc.input?.code !== 'string') continue;
      const list = bodies.get(codeKey(tc.input)) ?? [];
      list.push({ msg: i, id: tc.id, kind: 'input', signed: !!tc.thoughtSignature });
      bodies.set(codeKey(tc.input), list);
    }
  }
  for (const list of bodies.values()) {
    for (const b of list.slice(keep)) if (!b.signed) stubCode.add(`${b.msg}:${b.id}:${b.kind}`);
  }

  // Failed calls old enough to drop their large inputs.
  const stubFailed = new Set<string>(); // toolCall id
  let assistantTurnsAfter = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant') continue;
    if (assistantTurnsAfter >= opts.failedCallInputTurns) {
      for (const tc of m.toolCalls ?? []) {
        if (failed.has(tc.id) && !tc.thoughtSignature && JSON.stringify(tc.input ?? {}).length >= opts.failedCallInputMinChars) {
          stubFailed.add(tc.id);
        }
      }
    }
    assistantTurnsAfter++;
  }

  if (stubCode.size === 0 && stubDoc.size === 0 && stubFailed.size === 0) return history;

  return history.map((m, i): ChatMessage => {
    let changed = false;
    const toolCalls = m.toolCalls?.map((tc): PersistedToolCall => {
      if (stubFailed.has(tc.id)) { changed = true; return { ...tc, input: stubLargeInputs(tc.input) }; }
      if (stubCode.has(`${i}:${tc.id}:input`)) { changed = true; return { ...tc, input: { ...tc.input, code: SUPERSEDED_CODE_NOTE } }; }
      return tc;
    });
    const toolResults = m.toolResults?.map((r): PersistedToolResult => {
      if (stubCode.has(`${i}:${r.toolUseId}:result`)) { changed = true; return { ...r, content: SUPERSEDED_GETCODE_NOTE }; }
      if (stubDoc.has(`${i}:${r.toolUseId}`)) { changed = true; return { ...r, content: REPEATED_DOC_NOTE }; }
      return r;
    });
    if (!changed) return m;
    return { ...m, ...(toolCalls ? { toolCalls } : {}), ...(toolResults ? { toolResults } : {}) };
  });
}
