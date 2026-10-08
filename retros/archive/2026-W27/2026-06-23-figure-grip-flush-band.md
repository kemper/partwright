# Retro — figure grip/band/necklace root-cause fixes (2026-06-23)

4-Ls from a multi-round review on the accessory showcase figures (knight/scholar/
noble lady). The reviewer kept flagging the SAME categories; the win was fixing
the mechanism, not the model.

## Liked
- `F.poseProbe(rig).grips.R.gripAxis` let me find the right arm pose **without
  rendering** — a vite-node probe over ~10 candidate poses found the blade-up grip
  in seconds, vs minutes-per-render guessing. Measuring the rig beats eyeballing.
- The "conform + offset-surface, then slice" clothing trick generalized cleanly:
  the cuirass already did it, so `F.band` (flush belt) was the same three ops.

## Lacked
- No way to declare "a held prop points THIS way." The grip axis is ⊥ the forearm,
  so prop aim is an emergent property of the arm pose — non-obvious, and the thing
  that made the sword wrong twice. Fixed by adding the declarative `palm` hint, but
  it took realizing the coupling first.
- The wrist-roll solver has a singularity at `bend≳95` (blade flips). Documented,
  not fixed — a robust solve would detect the near-pole case.

## Learned
- **A held bar's direction follows the FOREARM, not `holdAt`.** `gripAxis` ⊥ forearm
  (you grip across the palm), so to point a blade up the forearm must be horizontal;
  a vertical forearm forces a horizontal blade. This is the root cause AI agents
  miss when posing armed figures.
- A round tube (`F.ring`) always reads as "welded on." A flush band must be a SLICE
  of the offset body surface (the clothing mechanism), never a swept tube.
- A big `drape` on a neck ring spreads it to chest width (collar-trim look). A real
  draping necklace = small neck ring + a separate centreline pendant drop.

## Longed for
- A headless "does this prop point where I intended?" assertion (like
  `--require-labels` but for grip aim) so pose regressions are caught in the fast
  loop, not at review.
