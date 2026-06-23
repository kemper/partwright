// Insert-palette undo / redo stack — captures atomic palette operations
// (create / delete / union / subtract / intersect / duplicate / mirror / move /
// resize / align) as snapshots of (code, registry, specByName, selection) and
// lets the user step back and forward through them. Strictly coarser-grained
// than CodeMirror's text-edit history: one Tinkercad-style action = one undo
// step, regardless of how many text/registry/spec edits it carries underneath.
//
// The stack is dependency-free (no Three.js, no DOM) so the unit tier can
// exercise its semantics directly. Both the palette and arrangeMode share a
// single stack instance via initUndoStack at boot; recordOperation snapshots
// the *before* state, runs the work, and pushes IF anything actually changed
// (cheap insurance against no-op paths leaking phantom undo steps).

import type { PrimitiveSpec } from './codegen';
import type { RegistryEntry } from './spatial';

export interface UndoSnapshot {
  label: string;
  code: string;
  registry: Array<[string, RegistryEntry]>;
  specByName: Array<[string, PrimitiveSpec]>;
  selection: string[];
}

export interface UndoStackDeps {
  getCode: () => string;
  setCode: (code: string) => void;
  registry: Map<string, RegistryEntry>;
  specByName: Map<string, PrimitiveSpec>;
  selection: Set<string>;
  /** Engine re-run after restoring a snapshot. */
  run: () => void;
  /** Notify the palette / arrange-mode that they should redraw chip strip,
   *  selection box overlay, undo/redo button enabled state, etc. */
  onAfterRestore: () => void;
}

let deps: UndoStackDeps | null = null;
let history: UndoSnapshot[] = [];
let cursor = -1; // index of the most recently applied snapshot's predecessor
let listeners: Array<() => void> = [];

/** Cap memory so a long arrange session can't blow up the heap. 100 is plenty
 *  for an interactive editing session and ~1 KB / snapshot at typical part
 *  counts → ~100 KB max. */
const MAX_HISTORY = 100;

export function initUndoStack(d: UndoStackDeps): void {
  deps = d;
  history = [];
  cursor = -1;
  notify();
}

/** Subscribe to undo/redo state changes (push, undo, redo, clear). Returns
 *  an unsubscribe function. Used by the palette to keep the Undo/Redo buttons'
 *  enabled state in sync without polling. */
export function subscribeUndoStack(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notify(): void {
  for (const fn of listeners) fn();
}

function snapshot(label: string): UndoSnapshot {
  if (!deps) throw new Error('undoStack not initialized');
  return {
    label,
    code: deps.getCode(),
    registry: [...deps.registry.entries()].map(([k, v]) => [k, cloneRegistryEntry(v)]),
    specByName: [...deps.specByName.entries()].map(([k, v]) => [k, cloneSpec(v)]),
    selection: [...deps.selection],
  };
}

function cloneRegistryEntry(e: RegistryEntry): RegistryEntry {
  return { box: { min: [...e.box.min] as [number, number, number], max: [...e.box.max] as [number, number, number] }, center: [...e.center] as [number, number, number] };
}

function cloneSpec(s: PrimitiveSpec): PrimitiveSpec {
  // PrimitiveSpec is a discriminated union of plain objects; structuredClone
  // copies them safely without coercing into the union. JSON.parse would lose
  // undefined optional fields but spec types use plain values throughout.
  return structuredClone(s);
}

function restore(s: UndoSnapshot): void {
  if (!deps) return;
  deps.setCode(s.code);
  deps.registry.clear();
  for (const [k, v] of s.registry) deps.registry.set(k, cloneRegistryEntry(v));
  deps.specByName.clear();
  for (const [k, v] of s.specByName) deps.specByName.set(k, cloneSpec(v));
  deps.selection.clear();
  for (const name of s.selection) deps.selection.add(name);
  deps.run();
  deps.onAfterRestore();
}

/** Run an operation under undo recording: snapshot the before state, invoke
 *  `fn`, then push the snapshot onto the stack IF anything actually changed
 *  (cheap "did the code or selection move?" check skips no-op operations like
 *  "Resize 0 selected parts" without leaking phantom undo steps). Any redo
 *  tail is truncated — the redo only survives until the user makes a new edit,
 *  matching every other undoable app. */
export function recordOperation(label: string, fn: () => void): void {
  if (!deps) { fn(); return; }
  const before = snapshot(label);
  fn();
  const after = snapshot(label);
  if (snapshotsEqual(before, after)) return;
  // Truncate redo tail past the current cursor and push the BEFORE state. We
  // store BEFORE (not AFTER) so undo() steps back to it directly. cursor
  // advances to point at the new entry; redo from here re-applies AFTER.
  history = history.slice(0, cursor + 1);
  history.push(before);
  cursor = history.length - 1;
  if (history.length > MAX_HISTORY) {
    const drop = history.length - MAX_HISTORY;
    history = history.slice(drop);
    cursor -= drop;
  }
  notify();
}

function snapshotsEqual(a: UndoSnapshot, b: UndoSnapshot): boolean {
  if (a.code !== b.code) return false;
  if (a.selection.length !== b.selection.length) return false;
  for (let i = 0; i < a.selection.length; i++) if (a.selection[i] !== b.selection[i]) return false;
  if (a.registry.length !== b.registry.length) return false;
  if (a.specByName.length !== b.specByName.length) return false;
  // Map-equal heuristic: code change is the dominant signal; selection above
  // catches the no-text-change selection-only mutations. The registry / spec
  // arrays trail the code, so once code+selection match the rest follows by
  // construction.
  return true;
}

/** Step back to the previous snapshot. The current AFTER state is implicitly
 *  kept on the redo path so redo() can return us here. Returns the label of
 *  the operation that was undone (or null if nothing to undo). */
export function undo(): string | null {
  if (!deps || cursor < 0) return null;
  const target = history[cursor];
  // Before stepping back we need to PUSH the current state onto the redo path.
  // We do this by replacing `target` with a "redo entry" carrying the current
  // state and remembering the original BEFORE as a sibling. Simpler approach:
  // keep history as [before-states] and on undo we restore history[cursor]
  // and on redo we re-apply the operation. To support that, redo needs the
  // AFTER. We store AFTER inline in the entry's `redoState` field.
  // (Lazy capture: we set redoState the first time we undo past this entry.)
  const current: UndoSnapshot = snapshot(target.label);
  (target as UndoSnapshot & { redoState?: UndoSnapshot }).redoState = current;
  restore(target);
  cursor -= 1;
  notify();
  return target.label;
}

/** Step forward to the snapshot that was undone. Returns the label of the
 *  operation that was redone (or null if nothing to redo). */
export function redo(): string | null {
  if (!deps) return null;
  const next = history[cursor + 1] as (UndoSnapshot & { redoState?: UndoSnapshot }) | undefined;
  if (!next || !next.redoState) return null;
  restore(next.redoState);
  cursor += 1;
  notify();
  return next.label;
}

export function canUndo(): boolean { return cursor >= 0; }

export function canRedo(): boolean {
  const next = history[cursor + 1] as (UndoSnapshot & { redoState?: UndoSnapshot }) | undefined;
  return !!(next && next.redoState);
}

/** Label of the operation the next undo would reverse (for tooltip text). */
export function peekUndoLabel(): string | null {
  return cursor >= 0 ? history[cursor].label : null;
}

/** Label of the operation the next redo would re-apply. */
export function peekRedoLabel(): string | null {
  const next = history[cursor + 1] as (UndoSnapshot & { redoState?: UndoSnapshot }) | undefined;
  return next && next.redoState ? next.label : null;
}

/** Drop the entire history. Called on session-change so a stale `box` from
 *  the previous session can't reappear via undo. */
export function clearUndoHistory(): void {
  history = [];
  cursor = -1;
  notify();
}

// Test-only inspection — keeps the spec hermetic without exporting the
// module-private `history` / `cursor` arrays. Production callers should use
// `canUndo` / `canRedo` / `peekUndoLabel` / `peekRedoLabel` instead.
export function __testGetHistoryLength(): number { return history.length; }
export function __testGetCursor(): number { return cursor; }
