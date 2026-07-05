// Selection store — named, uncolored triangle sets that scope paint
// operations. The missing noun behind every observed paint-bleed mode:
// paint tools historically conflated *deciding where* (a box, a flood, a
// disc) with *committing color*, so a selector that overshot painted the
// overshoot. A selection is a hard boundary: paint tools that take
// `within: {selection}` intersect their selector with it, so bleed outside
// the selection is impossible by construction.
//
// Selections store their SOURCE EXPRESSION (base selector + refinements)
// and re-resolve lazily against the current mesh — the same
// descriptor-not-baked-ids philosophy paint regions use — so a smoothing
// paint that subdivides the mesh doesn't strand them. Resolution itself is
// main.ts's job (it owns the selectors); this module is a LEAF that only
// stores expressions and caches resolved sets per mesh identity.
//
// Selections are RUNTIME-ONLY in this iteration — they live for the current
// page like the label map does, and are cheap to recreate from their source
// selectors. Persisting them into the session schema is deferred (#881)
// until the render-only-import persistence gap (#883) is fixed.

export type RefineOp = 'add' | 'subtract' | 'intersect';

/** A selector expression node. Opaque to this store — main.ts's
 *  `resolveSelectorNode` interprets it. Kept as a plain JSON-ish object so
 *  a future persistence pass can serialize it directly. */
export type SelectorNode = Record<string, unknown>;

export interface Selection {
  /** Session-unique id (monotonic, never reused). */
  id: number;
  /** Unique name. Auto-generated (`selection-N`) when not supplied. */
  name: string;
  /** Source selector. */
  base: SelectorNode;
  /** Ordered refinements applied on top of `base`. */
  refinements: { op: RefineOp; node: SelectorNode }[];
  /** Human-readable build trace for listSelections() introspection. */
  history: string[];
  /** Resolved triangles, valid only while `cacheMesh` is the current mesh.
   *  Keyed by object identity — a new run / import / subdivision produces a
   *  fresh MeshData and invalidates the cache implicitly. */
  cache: Set<number> | null;
  cacheMesh: unknown;
}

let selections: Selection[] = [];
let nextId = 1;

export function createSelection(base: SelectorNode, sourceLabel: string, name?: string): Selection | { error: string } {
  const finalName = name ?? `selection-${nextId}`;
  if (selections.some(s => s.name === finalName)) {
    return { error: `A selection named "${finalName}" already exists — pick another name, or removeSelection it first.` };
  }
  const sel: Selection = {
    id: nextId++,
    name: finalName,
    base,
    refinements: [],
    history: [sourceLabel],
    cache: null,
    cacheMesh: null,
  };
  selections.push(sel);
  return sel;
}

export function getSelection(ref: number | string): Selection | undefined {
  return typeof ref === 'number'
    ? selections.find(s => s.id === ref)
    : selections.find(s => s.name === ref);
}

export function listSelections(): readonly Selection[] {
  return selections;
}

export function removeSelection(ref: number | string): boolean {
  const sel = getSelection(ref);
  if (!sel) return false;
  selections = selections.filter(s => s !== sel);
  return true;
}

export function renameSelection(ref: number | string, name: string): Selection | { error: string } {
  const sel = getSelection(ref);
  if (!sel) return { error: `No selection ${JSON.stringify(ref)}.` };
  if (selections.some(s => s !== sel && s.name === name)) return { error: `A selection named "${name}" already exists.` };
  sel.name = name;
  return sel;
}

export function addRefinement(ref: number | string, op: RefineOp, node: SelectorNode, opLabel: string): Selection | { error: string } {
  const sel = getSelection(ref);
  if (!sel) return { error: `No selection ${JSON.stringify(ref)}. listSelections() shows what exists.` };
  sel.refinements.push({ op, node });
  sel.history.push(`${op}: ${opLabel}`);
  sel.cache = null;
  sel.cacheMesh = null;
  return sel;
}

/** Drop the last refinement (the undo for a refinement that emptied or
 *  wrecked the selection). Returns false when there's nothing to pop. */
export function popRefinement(ref: number | string): boolean {
  const sel = getSelection(ref);
  if (!sel || sel.refinements.length === 0) return false;
  sel.refinements.pop();
  sel.history.push('(reverted last refinement)');
  sel.cache = null;
  sel.cacheMesh = null;
  return true;
}

/** Resolve a selection to triangles via `resolveNode`, applying the
 *  refinement chain. Cached per mesh identity. `resolveNode` returns the
 *  triangle set for one selector node, or a string error. */
export function resolveSelection(
  sel: Selection,
  mesh: unknown,
  resolveNode: (node: SelectorNode) => Set<number> | string,
): Set<number> | { error: string } {
  if (sel.cache && sel.cacheMesh === mesh) return sel.cache;
  const baseRes = resolveNode(sel.base);
  if (typeof baseRes === 'string') return { error: `selection "${sel.name}": ${baseRes}` };
  let acc = new Set(baseRes);
  for (const { op, node } of sel.refinements) {
    const other = resolveNode(node);
    if (typeof other === 'string') return { error: `selection "${sel.name}" refinement (${op}): ${other}` };
    if (op === 'add') {
      for (const t of other) acc.add(t);
    } else if (op === 'subtract') {
      const next = new Set<number>();
      for (const t of acc) if (!other.has(t)) next.add(t);
      acc = next;
    } else {
      const next = new Set<number>();
      for (const t of acc) if (other.has(t)) next.add(t);
      acc = next;
    }
  }
  if (acc.size === 0) return { error: `selection "${sel.name}" resolves to zero triangles on the current mesh — its refinements cancel out, or the geometry changed. Recreate it (or popRefinement).` };
  sel.cache = acc;
  sel.cacheMesh = mesh;
  return acc;
}

/** Test hook / hard reset. */
export function clearSelections(): void {
  selections = [];
}
