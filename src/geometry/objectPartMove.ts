// Planning the Objects list's "Move to new object" / "Split into objects" for
// a selection of several parts or several pieces (#1003 follow-up). Pure: it
// takes the object's code and its parts/pieces summary and returns the code
// each object should end up with — main.ts dry-runs and commits them.
//
// Two ways to write a move, picked per selection:
// - PIECE FILTERS (wrapWithPieceFilter) when the selection is made of whole
//   separate solids — pieces, or parts that each sit on pieces of their own.
//   The code runs untouched and the result keeps / drops those solids, so cuts
//   and other parts' geometry are unaffected.
// - api.removePart LINES when a selected part is fused to geometry it doesn't
//   own (a handle on a mug): the original removes the selected parts, and each
//   new object removes every other part — the same line the part ✕ writes.

import type { ObjectPartsSummary } from './meshPieces';
import { wrapWithPieceFilter, type PieceBox } from './objectPartCode';
import { insertRemovalLine, removePartCall } from '../editor/removalCode';

export interface ObjectPartsMovePlan {
  /** The original object's code once the selection has moved out. */
  dropCode: string;
  /** One entry per new object, in selection order: its code and a short name
   *  for what it holds (the part names, or `piece N`). */
  objects: { code: string; name: string }[];
  /** Which way the code was rewritten (see the header). */
  via: 'pieces' | 'parts';
}

/** A short name for a list of things: up to three in full, else the first two
 *  and a count. */
export function shortListName(names: readonly string[]): string {
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** Plan moving the selection `keys` (`part:<name>` or `piece:<n>` keys, all
 *  the same kind) out of the object into one new object — or, with
 *  `separate`, one new object each. `boxOf` gives a piece's bounding-box
 *  identity for the piece filters. Returns { error } when it can't be done. */
export function planObjectPartsMove(
  code: string,
  summary: ObjectPartsSummary,
  keys: readonly string[],
  opts: { separate: boolean; boxOf: (pieceIndex: number) => PieceBox | null },
): ObjectPartsMovePlan | { error: string } {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return { error: 'nothing is selected.' };
  if (unique.includes('unlabeled')) return { error: 'the unlabeled geometry can’t be moved on its own — label it first (api.label), or move the pieces it’s on.' };
  const kind = unique[0].startsWith('part:') ? 'part' : unique[0].startsWith('piece:') ? 'piece' : null;
  if (!kind || unique.some(k => !k.startsWith(`${kind}:`))) return { error: 'pass several parts or several pieces — not a mix of both.' };

  if (kind === 'piece') {
    const indices = unique.map(k => Number(k.slice(6)));
    const missing = indices.find(i => !Number.isInteger(i) || !summary.pieces[i]);
    if (missing !== undefined) return { error: `no piece ${missing} — see listObjectParts().pieces.` };
    if (summary.pieces.length < 2) return { error: 'this object is a single piece.' };
    if (indices.length >= summary.pieces.length) return { error: 'that’s every piece — nothing would be left in the original object.' };
    const groups = opts.separate ? indices.map(i => [i]) : [indices];
    const name = (g: number[]) => shortListName(g.map(i => summary.pieces[i].part ?? `piece ${i + 1}`));
    return piecePlan(code, indices, groups.map(g => ({ pieces: g, name: name(g) })), opts.boxOf);
  }

  const names = unique.map(k => k.slice(5));
  const live = summary.parts.filter(p => p.triangles.size > 0);
  const missing = names.find(n => !live.some(p => p.name === n));
  if (missing !== undefined) return { error: `no part "${missing}" — see listObjectParts().` };

  // Whole pieces? Every piece the selection touches must be made only of
  // selected parts — then piece filters move them without touching the code.
  const trisOf = (n: string) => live.find(p => p.name === n)!.triangles;
  const selected = new Set<number>();
  for (const n of names) for (const t of trisOf(n)) selected.add(t);
  const touchedBy = (n: string) => summary.pieces.filter(p => p.triangles.some(t => trisOf(n).has(t))).map(p => p.index);
  const touched = [...new Set(names.flatMap(touchedBy))].sort((a, b) => a - b);
  const whole = touched.every(i => summary.pieces[i].triangles.every(t => selected.has(t)));
  if (whole && summary.pieces.length > 1 && touched.length < summary.pieces.length) {
    const groups = opts.separate ? names.map(n => ({ pieces: touchedBy(n), name: n })) : [{ pieces: touched, name: shortListName(names) }];
    // Split needs each part on pieces of its own; two selected parts fused
    // into one piece fall through to removal lines below.
    const shared = opts.separate && new Set(groups.flatMap(g => g.pieces)).size !== groups.reduce((s, g) => s + g.pieces.length, 0);
    if (!shared) return piecePlan(code, touched, groups, opts.boxOf);
  }

  if (summary.unlabeled.length > 0) {
    return { error: 'this object also has geometry no part covers, which would be copied into the new object too. Label it first (api.label), or move whole pieces instead.' };
  }
  if (names.length >= live.length) return { error: 'that’s every part — nothing would be left in the original object.' };
  const removing = (c: string, drop: readonly string[]) => drop.reduce((acc, n) => insertRemovalLine(acc, removePartCall(n)), c);
  const groups = opts.separate ? names.map(n => [n]) : [names];
  return {
    dropCode: removing(code, names),
    objects: groups.map(g => ({ code: removing(code, live.map(p => p.name).filter(n => !g.includes(n))), name: shortListName(g) })),
    via: 'parts',
  };
}

function piecePlan(
  code: string,
  dropIndices: readonly number[],
  groups: { pieces: number[]; name: string }[],
  boxOf: (pieceIndex: number) => PieceBox | null,
): ObjectPartsMovePlan | { error: string } {
  const boxes = (indices: readonly number[]) => indices.map(boxOf);
  const drop = boxes(dropIndices);
  if (drop.some(b => !b)) return { error: 'a selected piece has no geometry.' };
  const dropCode = wrapWithPieceFilter(code, 'drop', drop as PieceBox[]);
  if (!dropCode) return { error: 'the code has no top-level `return` to filter.' };
  const objects: { code: string; name: string }[] = [];
  for (const g of groups) {
    const keep = wrapWithPieceFilter(code, 'keep', boxes(g.pieces) as PieceBox[]);
    if (!keep) return { error: 'the code has no top-level `return` to filter.' };
    objects.push({ code: keep, name: g.name });
  }
  return { dropCode, objects, via: 'pieces' };
}
