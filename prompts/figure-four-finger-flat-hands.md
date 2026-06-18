---
date: 2026-06-18
branch: claude/nice-dijkstra-xxdsz6
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

We previously modeled the figure hands as having three fingers and one thumb.
Make it four fingers. Also make the hands a little flatter and more realistic —
not so bubbly. Show lots of before/after previews; create a PR if confident.
(Follow-up mid-task: "I want flatter hands.")

## Assistant

The hands are built in one place: `buildHands` in `src/geometry/sdfFigure.ts`.
The old hand was a fat round palm (a 0.72·r.hand sphere-capsule) plus three thick
finger capsules and a thumb — bubbly because the palm's front-to-back thickness
≈ its width, and only three fingers in a `[-1, 0, 1]` loop.

Two design constraints shaped the fix:

1. **No non-uniform scale.** The SDF deliberately omits a squash op (it breaks the
   distance field / Lipschitz property — see the ellipsoid note in `sdf.ts`),
   using `ellipsoid`/`roundedBox` for "squashed" shapes instead. But those are
   axis-aligned in world space, and the hand frame is an arbitrary rotated basis
   (dir/splay/palmN). Rotating a flat primitive into that frame needs full
   orientation, which the Euler-only `rotate` makes fragile.
2. So I flattened **within the capsule idiom**: the palm is now a thin wedge PAD
   built from two splay-swept capsules (a narrow wrist bar + a wide knuckle bar)
   welded together. A round capsule's radius sets the small front-to-back
   thickness while the sweep sets the larger width — flat without any scale op.

Changes:
- **3 → 4 fingers**: loop is now `[-1.5, -0.5, 0.5, 1.5]` with anatomical lengths
  `[0.80, 0.99, 1.05, 0.93]` (middle pair longest). Fingers are packed at the
  knuckles and fanned toward the tips so the bases web (solid) while the tip gaps
  stay above the march/extrusion width — the printability concern the old
  three-finger comment raised. Fingers are `tapered` (slimmer toward the tip).
- **Flatter/less bubbly**: finger radius 0.24 → 0.155·r.hand; palm half-depth
  0.20·r.hand (the old blob was ~0.72). Fist: 3 → 4 knuckle ridges, slimmer, ball
  slightly flatter.
- **L/R symmetry fix**: the rig's `elbowHinge` is *not* X-mirrored (splay.x is
  identical for both hands), so my off-centre finger-length profile broke the
  `splay symmetrically L/R` test (the old narrow fan hid it). Multiplying the
  finger splay offset by `side` makes the two hands true mirror images (and puts
  the index finger next to the thumb on both — anatomically correct).

Verified headlessly with `model:preview` across all three grips (palm + top-down
flatness views), built before/after montages from an `origin/main` git worktree,
and confirmed two real examples (boxer/fist, princess/open) still build manifold
and single-component. Added a `four separated fingers` unit test that sweeps a
sampling line up the fingers and asserts the max separated-run count is 4 (robust
to future length tweaks). Updated the two stale "three-finger" references in
`public/ai/figure.md`. Full preflight (typecheck + 1482 unit + lint) is green.
