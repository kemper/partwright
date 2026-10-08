---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
pr: 830
---

# 4-Ls — garment parts root-cause fix + vestigial-API cleanup

## Liked
- Quantifying the fix instead of eyeballing it: a `vite-node` probe measured the
  arm-overlap volume (whole-body conform 157u³ → torso conform 55u³ → torso +
  `clear` 0u³) BEFORE the expensive bake. That number, not a screenshot, is what
  made "it's actually fixed this time" credible after three prior front-view
  "fixes" shipped broken.
- Rendering the SIDE and BACK first. Every prior belt "fix" passed the front and
  failed the side; making the side/3-quarter the *primary* check caught it.

## Lacked
- A test that the catalog's EMBEDDED code still runs against the current API.
  Removing `F.layers` would have silently shipped two catalog entries whose
  embedded session code throws `F.layers is not a function` on load — caught only
  because I happened to grep the JSONs. A CI check that each `public/catalog/*.json`
  builds against the live engine would have flagged it structurally.

## Learned
- **After a paradigm shift, audit for vestigial APIs.** The parts approach made
  `F.layers` redundant, but it didn't error or warn — every caller just passed
  `carve:false`, so it silently degraded to a no-op `sdf.union` while still looking
  load-bearing in the source. A "do we still use this, or is it now ceremony?" pass
  is its own cleanup step, separate from the feature work.
- A demoted-but-present knob is an **attractive nuisance**: leaving `occludeArms`
  in the agent-facing API (even documented as "legacy, prefer parts") invites the
  next agent to reach for the exact mechanism that failed three sessions. Removing
  it beats deprecating it.

## Longed for
- A headless "does this catalog entry still build?" gate (see Lacked) — cheap to
  add, would have turned a grep-luck catch into a guarantee. Worth filing.
