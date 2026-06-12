---
session: "aiK0c"
timestamp: "2026-06-12T01:40:00Z"
sequence: 9
---

## Human

(work-reviewer subagent output on PR #609's branch.) Two IMPORTANT
findings + tightens. Address before pushing.

1. setPartRotateScad has an `if (scaleMatch)` / `else` branch that
   produces identical strings — dead branch with misleading comment.
2. Alt-modifier for Z-drag is re-read per pointermove instead of locked
   at drag start. Releasing alt mid-drag switches the plane and jumps
   the ghost. UX surprise.
3. Snap label says "Snap drag" but writePartTranslateDelta snaps every
   per-engine translate (align, rotate spread, drag). Mislabelled.
4. Snap-to-grid amplifies group-centroid drift — round-independently
   spreads can shift the layout up to N units. Doc note.
5. Rotate tooltip claims "around the part / group centroid" but only Z
   pivots around the group; X/Y are per-part.
6. parseStatement only accepts `.rotate(...).translate(...)`, not the
   reverse. Pin with a test.
7. SCAD rotate test coverage gaps: no bare-cube, no scale-only-without-
   translate, no full translate+scale chain.

## Assistant

## Decisions

**#2 (UX) — Lock `dragVertical` at threshold cross, not per pointermove.**
Read `e.altKey` once inside the threshold-crossed branch of
`onPointerMove`, store on `dragVertical`, and use that for the rest of
the gesture. Releasing alt mid-drag no longer jumps the ghost between
horizontal-XY and vertical-Z planes. Cleared on `cancelDrag` so a stale
flag can't bleed across drags. Matches every other modifier-locked
gesture in the app (paint slab-fan, marquee shift-at-start).

**#1 — Collapsed the dead branch in `setPartRotateScad`.** The
`if (scaleMatch)` and `else` produced literally the same string; the
guard was a documentation hook the comment then mis-described. Single
path now (`afterTrans` already carries any leading scale, so prepending
`rotate` before it gives the right `translate(t) rotate(r) scale(s)
cube()` chain). Added an exhaustive comment explaining the
right-to-left SCAD application order so the next reader doesn't
re-introduce the branch chasing a phantom scale path.

**#3 — Snap label retitled to "Snap moves to whole units" + tooltip.**
The function name `writePartTranslateDelta` and its callers (drag
commit, align spread, group-centroid scale/rotate spread) all share
the same snap path. The label now covers the broader scope explicitly;
a `title` adds the per-flow list so a user toggling it for drag
cleanup understands the knock-on effects on align/group-spread.

**#5 — Rotate tooltip clarifies Z-only pivot for groups.** New text:
"For 2+ parts, the Z rotation also swings the group around its
centroid; X/Y rotations stay per-part." Mirrors what ai.md already says.

**#4 — Added a one-line drift caveat to ai.md's Snap-to-grid
paragraph.** Not a code fix — the per-part rounding is the documented
behaviour — but surfacing the limit lets a user dial it intentionally.

**#6 + #7 — Test additions:**
- `parseStatement` returns null for `.translate(...).rotate(...)` —
  pins the one-way chain-order contract so a future refactor can't
  accidentally accept it and break setPartRotateJs's "compound onto
  existing" expectation.
- `setPartRotateScad` covers (a) bare cube (no leading transforms),
  (b) scale-only without translate (exercises the collapsed-branch
  path), and (c) full `translate + scale + cube` (confirms the
  documented chain order `translate(t) rotate(r) scale(s) cube()`).

## Tests

184 codegen, 21 palette e2e, all green. Typecheck clean.

## Manual verification

Driver: same alt-drag scenario from the original review case —
alt+drag the ghost from its centre, release alt mid-gesture, see
that the ghost stays on the vertical plane. ✓
