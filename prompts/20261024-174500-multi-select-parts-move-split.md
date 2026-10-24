---
session: "d90f8d77"
timestamp: "2026-10-24T17:45:00Z"
---

## Human

When I'm using the object part view, like the interactive view, I feel like I
should really be able to hit the shift key and select multiple pieces or parts
that are in that view. And then, you know, be able to do things like move them
to their own object, split them.

## Assistant

## Key decisions

**Selection model.** `src/ui/partSelection.ts` now holds a list of keys. Shift,
Ctrl or ⌘-click on a rail row, or Shift-double-click in the viewport, adds a
key to the selection or takes it out. A selection is all parts or all pieces,
never a mix (`extendPartSelection`: clicking another kind starts a new
selection). The unlabeled remainder can only be selected on its own.
`getSelectedPartKey()` / `getSelectedPartName()` now return null when several
things are selected, so a multi-selection never narrows paint or texture
scope. The AI chat gets a multi-key context line instead
(`describePartKeys`, `partSelectionChatContext(keys)`).

**Group drawer.** When several things are selected, one drawer appears under
the last selected row. It offers Move (all into one new object), Split (one new
object each), Isolate, Hide, Delete and Ask AI. Parts also gained a
single-part "⤴ Extract".

**How a move rewrites code** (`src/geometry/objectPartMove.ts`, pure and unit
tested):
- If the selection covers whole separate solids, it uses the existing piece
  filters. That covers pieces, and parts that each sit on pieces of their own.
  The code runs untouched, so cuts are kept.
- If a part is fused to other geometry, it uses `api.removePart` lines, the
  same line the part ✕ writes. The original object removes the selected parts,
  and each new object removes every other part. A removed cutter fills its
  cut. This matches what delete already does, and it is documented.
- A split that would make two parts share one piece falls back to removal
  lines.
- A move is refused when unlabeled fused geometry would be copied into the new
  object, and when it would leave the original empty.
- Every rewrite is dry-run (`preflightRewrite`) before anything is committed.
- manifold-js only, like the existing Extract.

**Batch delete.** `deleteObjectPartOrPiece` became a wrapper around
`deleteObjectPartsOrPieces`. That function writes every removal line, then
does one run and saves one version, all or nothing. Undo restores the lines
one by one.

**Parity.** These API methods now take arrays: `selectObjectPart`,
`isolateObjectPart`, `setObjectPartHidden` and `deleteObjectPart`. A new
`extractObjectParts(targets, { separate })` was added, along with an AI tool of
the same name (SAVE_GATED, object-targetable). It is listed in the help table
and documented in ai.md.

**Lost-label noise.** An object with a piece filter on it no longer lists the
labels the filter dropped as "lost". This was already a wart on single-piece
Extract, and Move/Split made it very visible.
