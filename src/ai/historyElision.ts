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
//   - superseded code: every runAndSave / setCode / … carries the whole
//     program, so an N-step modeling loop re-sends N versions of it on every
//     request. Editor writes (and getCode results) are superseded only by
//     newer editor writes to the same object; the side-effect-free runners
//     (runIsolated, runAndAssert, runAndExplain — and runCode, which leaves
//     the editor alone when given code) only by newer runner calls, so a
//     scratch snippet never evicts the real program.
//   - repeated docs: a readDoc result is dropped when the same doc is read
//     again later (some subdocs are ~30k tokens).
//   - failed calls: once `failedCallInputTurns` newer assistant turns have
//     passed, the large inputs of a call that errored are dropped. Its error
//     message (what the model learned from) stays.
//
// Prompt caching: stubbing an old body edits an earlier message, which
// invalidates the provider's cached prefix (and llama.cpp's KV reuse) from
// there on. So, like the stepped image trim, bodies pile up to
// keep + `codeBodyTrimBatch` before being cut back to `keep` in one edit.
// A readDoc dedupe or failed-input drop edits history once per occurrence.
//
// Tool-call ids are NOT unique across a conversation (Gemini numbers calls
// per response, `gemini_call_0` every turn; WebLLM does the same), so a
// result is paired with its call by position — the assistant message and
// the user message right after it, the adjacency historyRepair.ts enforces —
// and every key carries the message index.
//
// Gemini signs function calls (`thoughtSignature`) and rejects tampered
// ones, so a signed call's input is never rewritten (its tool RESULT may
// still be).

/** Tools that write the editor / a version with a complete program. */
const EDITOR_CODE_TOOLS = new Set(['setCode', 'runAndSave', 'forkVersion']);
/** Tools that run a complete program without changing the editor. */
const RUNNER_CODE_TOOLS = new Set(['runCode', 'runIsolated', 'runAndAssert', 'runAndExplain']);
/** Tools that switch which object the untargeted tools act on. */
const OBJECT_SWITCH_TOOLS = new Set(['changeObject', 'createObject', 'deleteObject', 'restoreObject']);

export const SUPERSEDED_CODE_NOTE = '[code omitted from context: a later edit or read superseded it. Call getCode for the current source.]';
export const SUPERSEDED_RUN_NOTE = '[code omitted from context: a later run superseded this one. Call getCode for the editor source.]';
export const SUPERSEDED_GETCODE_NOTE = '[getCode result omitted from context: a later edit or read superseded it. Call getCode for the current source.]';
export const REPEATED_DOC_NOTE = '[doc omitted from context: the same readDoc call appears again later in this conversation.]';
export const FAILED_INPUT_NOTE = '[omitted from context: input of a failed call]';

export interface ToolPayloadPruneOptions {
  /** Newest code bodies kept verbatim per object (minimum 1). */
  keepRecentCodeBodies: number;
  /** Extra bodies allowed to pile up before a cache-breaking trim back to
   *  `keepRecentCodeBodies`. 0 = trim every step (sliding). */
  codeBodyTrimBatch: number;
  /** Assistant turns after which a failed call's large inputs go. */
  failedCallInputTurns: number;
  /** Only failed inputs at least this long (JSON chars) are touched… */
  failedCallInputMinChars: number;
  /** …and within one, only top-level values at least this long. */
  failedCallValueMinChars: number;
}

/** Drop each large top-level value, keeping the keys so the call still
 *  reads as what it was. */
function stubLargeInputs(input: Record<string, unknown>, minChars: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = JSON.stringify(v ?? null).length >= minChars ? FAILED_INPUT_NOTE : v;
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
  const max = keep + Math.max(0, Math.floor(opts.codeBodyTrimBatch));

  // Keys: `${msgIndex}:${toolCallId}` for inputs, `${msgIndex}:r:${toolUseId}`
  // for results (msgIndex = the message that carries the block).
  const inputKey = (i: number, id: string) => `${i}:${id}`;
  const resultKey = (i: number, id: string) => `${i}:r:${id}`;

  type Body = { key: string; signed: boolean };
  const editorBodies = new Map<string, Body[]>(); // object key → oldest-first
  const runnerBodies: Body[] = [];
  const docReads: Array<{ doc: string; key: string }> = [];
  const failedCalls: Array<{ assistantIdx: number; key: string }> = [];

  // Which object the untargeted code tools act on: an explicit `object`
  // argument, else the object "epoch" (bumped by each switch), so bodies
  // written before and after a changeObject never supersede each other.
  let epoch = 0;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    const next = history[i + 1];
    const results = new Map<string, PersistedToolResult>();
    if (next?.role === 'user') for (const r of next.toolResults ?? []) results.set(r.toolUseId, r);
    for (const tc of m.toolCalls) {
      const input = tc.input ?? {};
      const result = results.get(tc.id);
      const objectKey = typeof input.object === 'string' ? `o:${input.object}` : `e:${epoch}`;
      if (typeof input.code === 'string') {
        const body = { key: inputKey(i, tc.id), signed: !!tc.thoughtSignature };
        if (EDITOR_CODE_TOOLS.has(tc.name)) {
          const list = editorBodies.get(objectKey) ?? [];
          list.push(body);
          editorBodies.set(objectKey, list);
        } else if (RUNNER_CODE_TOOLS.has(tc.name)) {
          runnerBodies.push(body);
        }
      }
      if (result && !result.isError) {
        if (tc.name === 'getCode') {
          const list = editorBodies.get(objectKey) ?? [];
          list.push({ key: resultKey(i + 1, tc.id), signed: false });
          editorBodies.set(objectKey, list);
        } else if (tc.name === 'readDoc') {
          docReads.push({ doc: JSON.stringify(input), key: resultKey(i + 1, tc.id) });
        }
      }
      if (result?.isError && !tc.thoughtSignature && JSON.stringify(input).length >= opts.failedCallInputMinChars) {
        failedCalls.push({ assistantIdx: i, key: inputKey(i, tc.id) });
      }
      if (OBJECT_SWITCH_TOOLS.has(tc.name)) epoch++;
    }
  }

  // Body counts are stateless (derived from the totals), so every request
  // recomputes the same cut: stubbing waits until a list exceeds `max`, then
  // drops back to `keep` — imagesToElide's stepped schedule.
  const stubOldest = (list: Body[], onStub: (b: Body) => void) => {
    const n = imagesToElide(list.length, max, keep);
    for (const b of list.slice(0, n)) if (!b.signed) onStub(b);
  };
  const stubEditor = new Set<string>();
  const stubRunner = new Set<string>();
  const stubResult = new Set<string>(); // getCode results
  for (const list of editorBodies.values()) {
    stubOldest(list, b => (b.key.includes(':r:') ? stubResult : stubEditor).add(b.key));
  }
  stubOldest(runnerBodies, b => stubRunner.add(b.key));

  const stubDoc = new Set<string>();
  const newestDoc = new Map<string, string>();
  for (let k = docReads.length - 1; k >= 0; k--) {
    const d = docReads[k];
    if (newestDoc.has(d.doc)) stubDoc.add(d.key);
    else newestDoc.set(d.doc, d.key);
  }

  const assistantIdx = history.flatMap((m, i) => (m.role === 'assistant' ? [i] : []));
  const stubFailed = new Set<string>();
  for (const f of failedCalls) {
    const newer = assistantIdx.filter(i => i > f.assistantIdx).length;
    if (newer >= opts.failedCallInputTurns) stubFailed.add(f.key);
  }

  if (stubEditor.size + stubRunner.size + stubResult.size + stubDoc.size + stubFailed.size === 0) return history;

  return history.map((m, i): ChatMessage => {
    let changed = false;
    const toolCalls = m.toolCalls?.map((tc): PersistedToolCall => {
      const k = inputKey(i, tc.id);
      if (tc.thoughtSignature) return tc;
      if (stubFailed.has(k)) { changed = true; return { ...tc, input: stubLargeInputs(tc.input, opts.failedCallValueMinChars) }; }
      if (stubEditor.has(k)) { changed = true; return { ...tc, input: { ...tc.input, code: SUPERSEDED_CODE_NOTE } }; }
      if (stubRunner.has(k)) { changed = true; return { ...tc, input: { ...tc.input, code: SUPERSEDED_RUN_NOTE } }; }
      return tc;
    });
    const toolResults = m.toolResults?.map((r): PersistedToolResult => {
      const k = resultKey(i, r.toolUseId);
      if (stubResult.has(k)) { changed = true; return { ...r, content: SUPERSEDED_GETCODE_NOTE }; }
      if (stubDoc.has(k)) { changed = true; return { ...r, content: REPEATED_DOC_NOTE }; }
      return r;
    });
    if (!changed) return m;
    return { ...m, ...(toolCalls ? { toolCalls } : {}), ...(toolResults ? { toolResults } : {}) };
  });
}
