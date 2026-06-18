# Retro — figure four-finger flat hands (PR #748)

## Liked
- The `origin/main` git **worktree** trick made a fair before/after trivial:
  render the OLD `buildHands` from a clean checkout with the *same* preview script
  + views, then montage BEFORE-over-AFTER with native `sharp`. One labelled image
  per grip told the whole story at a glance — far better than describing the change.
- A top-down (`--view 0,90`) tile is the single best "is it flatter?" check: the
  bubbly blob → thin bar contrast is unmistakable, where the palm view alone
  can't show depth.
- `vite-node` probing of the rig (`__figureTestables__`) located the real cause
  of a failing symmetry test in ~10 lines instead of guessing.

## Lacked
- No non-uniform scale in the SDF (deliberately — it breaks the distance field),
  and the only flat primitives (ellipsoid/roundedBox) are world-axis-aligned while
  the hand frame is an arbitrary rotated basis. There's no clean "build in a local
  frame, orient to basis" helper — `eulerAlignZ` only pins one axis (roll free),
  and the file's idiom is world-space point composition. I had to flatten *within*
  the capsule idiom (a splay-swept thin pad). A `node.alignToBasis(x,y,z)` helper
  would unlock genuinely flat oriented parts (palms, blades, fins) directly.

## Learned
- **The rig's `elbowHinge` is NOT X-mirrored** — `splay.x` is *identical* for L and
  R hands, not opposite. So any L/R-symmetric hand must fold `side` into the finger
  splay explicitly; without it an off-centre finger-length profile silently breaks
  the `splay symmetrically L/R` test. The old narrow 3-finger fan hid this; a wider
  fan exposed it. (Bonus: folding in `side` also puts the index finger next to the
  thumb on both hands — anatomically correct, for free.)
- A flat pad from round capsules: sweep a capsule *along the width axis* so the
  radius sets the small front-to-back depth and the sweep sets the larger width —
  flat without any scale op. Two such bars (narrow wrist + wide knuckles) welded =
  a convincing wedge palm.
- More fingers ≠ less printable: thinner fingers (fr 0.24→0.155·r.hand) that web at
  the base and fan at the tips kept the min inter-finger gap (0.159) *wider* than
  the old 3-finger hand (0.144). Verified empirically, not assumed.

## Longed for
- A `--view` named alias for "top-down flatness" and a built-in before/after
  montage mode in `model:preview` (e.g. `--against <ref>` that renders the same
  model from a git ref and tiles them) — I hand-rolled the worktree + sharp montage,
  which is the kind of comparison every geometry-tweak PR wants.
- A one-shot "rebake every catalog entry whose source/builder changed" command.
  This hand change quietly staled all 21 figure bakes (→ issue #751); there's still
  no command that detects "the builder these were baked against moved" and rebakes
  just the affected set.
