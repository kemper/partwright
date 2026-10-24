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

## Assistant

## Review follow-ups

A review agent went over the first commit. These are the fixes and the
reasoning behind them:

- **Keep filters narrow (blocking bug).** Before this fix, a keep filter
  applied to code that already had one merged the old and new piece lists.
  Moving pieces out of an object that was itself made by Move therefore
  duplicated geometry. A keep is now always a subset of what the object
  already keeps, so the new list simply replaces the old one. Drop filters
  still merge.
- **Verify before committing.** The planner now records what each object must
  contain: the parts that must have triangles, the parts that must have none,
  and the piece count. `moveObjectSelection` checks every dry-run against
  that, using `executeIsolated`, which now also returns `labelMap`. A rewrite
  that runs but moves the wrong geometry (for example with nested labels) is
  refused before anything changes.
- **Order of commits.** I tried creating the new objects first and saving the
  original last. That needs two extra object switches, and those made the
  existing extract e2e test flaky: a late editor run raced the test's next
  `runAndSave`. So the original order stays: save the original first, then
  create the new objects. That is safe now because every rewrite is verified
  by its dry-run before anything is committed. A save error after that point
  says what was already done and points to the original's version history.
- **Colours move with their parts.** `byLabel` fills (the swatch colour) of
  parts that move entirely into a new object are re-applied there and removed
  from the original. Without this they stayed behind as unmatched paint.
- **Undo after a multi-delete** uses the new `restoreObjectPartsOrPieces`: one
  run and one version, matching the batch delete.
- **Touch.** A "Select more" toggle in the drawers (labelled ☐ Add in the UI) makes plain taps extend the
  selection, because phones and tablets have no Shift key.
- **API.** A list passed to `setObjectPartHidden` is validated in full before
  anything is hidden, and `deleteObjectPart` refuses a list that mixes parts
  and pieces.
- **Left as is:** a piece-filtered object still hides every "lost" label. The
  labels a filter drops can't be told apart from genuinely lost ones, because
  both have zero triangles.
