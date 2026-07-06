---
session: "part-grouping-catalog"
timestamp: "2026-07-06T05:15:00Z"
model: claude-opus-4-8
sequence: 2
---

## Human

(PR #894 review pass — work-reviewer flagged findings on the part-grouping
branch.) Address the actionable ones.

## Assistant

## Key decisions

**Fixed the should-fix regression: a collapsed group disabled ALL drag
reordering.** Collapsed groups render no member rows, so the drop handler's
`layout` (built from mounted `[data-part-id]` rows) was shorter than the part
list and the `layout.length === currentIds.length` guard always failed → every
drag silently no-oped once any group was collapsed. Rebuilt `finish()` to derive
the new order from the FULL `state.parts`: find the first mounted row after the
drop indicator (`beforeId`), splice the dragged id in ahead of it, and leave
collapsed-group members at their existing relative positions. The dragged part
still takes the indicator's group; everyone else keeps theirs.

**Made `setPartGroup` atomic (nit).** Replaced the per-part `dbUpdatePart` loop
with a single-transaction `updatePartGroups(ids, group)` in `db.ts`, matching the
`updatePartOrders` pattern, so a multi-part group/ungroup can't half-commit.

**Skipped** the "no ungroup drop-zone directly above a group header" nit — minor
UX gap, ungrouping is fully reachable via the action bar and header ⊘, and adding
a header drop-zone isn't worth the drag complexity for v1.

Added two e2e guards: reorder-while-collapsed and drag-a-part-into-a-group-body.
Both drag tests needed a tall viewport (the parts-list is a short scroll box at
the default 720px height, which put target rows outside the clip and made
absolute-position drags miss).
