// The open object's selected PART (or piece) — one shared selection read by the
// Objects rail, the viewport (double-click a part to select it), the paint
// tools, the Surface panel and the AI chat. Design rule (#1003): the selection
// is a SCOPE, not a new editor — existing tools confine themselves to it
// instead of the rail growing its own editing features.
//
// A leaf module (no imports) so paint, rail and main can all read it without
// creating a dependency cycle.
//
// Keys: `part:<label name>` (an api.label region — the only kind that scopes
// paint), `piece:<n>` (a connected component) or `unlabeled`.
//
// Several parts (or several pieces) can be selected at once — Shift/Ctrl/⌘-
// click in the rail or Shift-double-click in the viewport — for the group
// actions (move to a new object, split, hide, delete) and as chat context. A
// multi-selection never scopes paint or textures: getSelectedPartKey() /
// getSelectedPartName() report only a single selection.

type Listener = () => void;

let selectedKeys: string[] = [];
const listeners: Listener[] = [];

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** The selected key (`part:<name>` | `piece:<n>` | `unlabeled`) when exactly
 *  one thing is selected; null when nothing — or several things — are. */
export function getSelectedPartKey(): string | null {
  return selectedKeys.length === 1 ? selectedKeys[0] : null;
}

/** Every selected key, in the order they were selected. */
export function getSelectedPartKeys(): string[] {
  return [...selectedKeys];
}

/** The selected PART's label name — null when nothing (or a piece / the
 *  unlabeled remainder, or several things) is selected. This is what paint
 *  scopes to. */
export function getSelectedPartName(): string | null {
  const key = getSelectedPartKey();
  return key?.startsWith('part:') ? key.slice(5) : null;
}

/** Select exactly `key` (null clears). */
export function setSelectedPartKey(key: string | null): void {
  setSelectedPartKeys(key === null ? [] : [key]);
}

/** Replace the selection with `keys` (deduplicated, order kept). */
export function setSelectedPartKeys(keys: readonly string[]): void {
  const next = [...new Set(keys)];
  if (next.length === selectedKeys.length && next.every((k, i) => k === selectedKeys[i])) return;
  selectedKeys = next;
  notify();
}

/** The selection after a Shift/Ctrl/⌘-click on `key`: a selected key leaves
 *  it; a key of the same kind as the selection (parts with parts, pieces with
 *  pieces) joins it; anything else — another kind, or the unlabeled remainder,
 *  which is a single region — starts a new selection. Pure. */
export function extendPartSelection(current: readonly string[], key: string): string[] {
  if (current.includes(key)) return current.filter(k => k !== key);
  const kind = (k: string) => (k.startsWith('part:') ? 'part' : k.startsWith('piece:') ? 'piece' : k);
  if (current.length === 0 || key === 'unlabeled' || kind(current[0]) !== kind(key)) return [key];
  return [...current, key];
}

/** A stable identity for a selection (used to tell whether the isolation
 *  shows the current selection). */
export function partSelectionSignature(keys: readonly string[]): string {
  return keys.join('\n');
}

export function onPartSelectionChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Human wording for a selection key (`part "handle"`, `piece 2`, …). */
export function describePartKey(key: string): string {
  if (key.startsWith('part:')) return `part "${key.slice(5)}"`;
  if (key.startsWith('piece:')) return `piece ${Number(key.slice(6)) + 1}`;
  return 'the unlabeled geometry';
}

/** Human wording for a whole selection (`parts "a", "b"`, `pieces 1, 3`, …). */
export function describePartKeys(keys: readonly string[]): string {
  if (keys.length === 1) return describePartKey(keys[0]);
  if (keys.length > 0 && keys.every(k => k.startsWith('part:'))) return `parts ${keys.map(k => `"${k.slice(5)}"`).join(', ')}`;
  if (keys.length > 0 && keys.every(k => k.startsWith('piece:'))) return `pieces ${keys.map(k => Number(k.slice(6)) + 1).join(', ')}`;
  return keys.map(describePartKey).join(', ');
}

/** The context line the AI chat prepends while something is selected, so "it"
 *  / "this part" (or "these") in the user's message resolves to the selection. */
export function partSelectionChatContext(keyOrKeys: string | readonly string[]): string {
  const keys = typeof keyOrKeys === 'string' ? [keyOrKeys] : keyOrKeys;
  if (keys.length > 1) {
    const names = keys.filter(k => k.startsWith('part:')).map(k => JSON.stringify(k.slice(5)));
    const where = names.length === keys.length
      ? ` Change their code at their api.label(…) calls (${names.join(', ')}).`
      : ' (see listObjectParts).';
    return `[Selected in the Objects list: ${describePartKeys(keys)} of the current object. "They" / "these" refers to them.${where}]`;
  }
  const key = keys[0];
  if (key.startsWith('part:')) {
    const name = JSON.stringify(key.slice(5));
    return `[Selected in the Objects list: part ${name} of the current object. "It" / "this part" means this part; confine edits to it — e.g. paint with withinPart: ${name} and change its code at its api.label(…, ${name}) call.]`;
  }
  return `[Selected in the Objects list: ${describePartKey(key)} of the current object (see listObjectParts). "It" / "this" refers to it.]`;
}

/** Split a user chat message into the selection context line the panel
 *  prepended (see partSelectionChatContext) and the user's own text, so the
 *  transcript can show the context as a chip instead of raw bracket text. */
export function splitPartSelectionContext(text: string): { context: string | null; rest: string } {
  const m = /^\[Selected in the Objects list: ([\s\S]*?) of the current object[\s\S]*?\]\n\n/.exec(text);
  return m ? { context: m[1], rest: text.slice(m[0].length) } : { context: null, rest: text };
}
