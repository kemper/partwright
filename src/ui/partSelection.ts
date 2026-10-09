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

type Listener = () => void;

let selectedKey: string | null = null;
const listeners: Listener[] = [];

/** The selected key (`part:<name>` | `piece:<n>` | `unlabeled`), or null. */
export function getSelectedPartKey(): string | null {
  return selectedKey;
}

/** The selected PART's label name — null when nothing (or a piece / the
 *  unlabeled remainder) is selected. This is what paint scopes to. */
export function getSelectedPartName(): string | null {
  return selectedKey?.startsWith('part:') ? selectedKey.slice(5) : null;
}

export function setSelectedPartKey(key: string | null): void {
  if (key === selectedKey) return;
  selectedKey = key;
  for (const fn of [...listeners]) fn();
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

/** The context line the AI chat prepends while something is selected, so "it"
 *  / "this part" in the user's message resolves to the selection. */
export function partSelectionChatContext(key: string): string {
  if (key.startsWith('part:')) {
    const name = JSON.stringify(key.slice(5));
    return `[Selected in the Objects list: part ${name} of the current object. "It" / "this part" means this part; confine edits to it — e.g. paint with scope: { label: ${name} } and change its code at its api.label(…, ${name}) call.]`;
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
