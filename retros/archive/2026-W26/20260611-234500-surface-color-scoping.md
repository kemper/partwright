---
date: "2026-06-11T23:45:00Z"
task: "fix+feat: surface texture color carry-through and label/region scoping (PR #590)"
pr: 590
areas: [surface, ui, geometry-api, git-workflow]
cost: medium
---

## Liked / Worked
- **The seeds+radius scoping design avoided the hard problem entirely.** The
  obvious approach (thread output-tri→base-tri provenance through every
  modifier kernel) would have touched all 9 modifiers and the subdivision
  code. Resolving scope to seed centroids main-side and re-selecting near
  them in the Worker (`selectTrianglesNearSeeds`) needed zero kernel changes
  and is robust to chaining for free. Spending the design turn before the
  implementation turn paid for itself several times over.
- **The explore agent's pipeline map was the keystone**: it surfaced that the
  bake path already had `nearestTriangleMap` (so the color fix was a reuse,
  not an invention), that `apply*Patch` triangle-subset texturing already
  existed (so scoped ops were a dispatch change), and that `pickFace` already
  returns the world-space hit point (so click-capture was UI-only).
- **`parseSurfaceOpts` extracted to the leaf spec module** kept the Worker
  recorder and console twin validation from drifting — the previous duplicate
  validators had already started to diverge in error wording.

## Lacked
- **Same-feature collision with another branch.** PR #595 landed a competing
  knurl surface modifier on main while this branch carried its own —
  vocabulary conflicts (pitch/aspect/pattern vs cellWidth/cellHeight/style/
  sharpness) across 7 files, twice (main advanced again mid-task). Cost: two
  conflict-resolution rounds plus retro-fitting tests/docs to main's params.
  No mechanism exists to discover "another open branch is building the same
  feature" before both invest.
- **The promptlog guard fires before the compound command runs**, so
  `git add -A && git commit` is denied before the add stages the log — looks
  like the guard is wrong when it's the sequencing. (cost: 2 confused turns)

## Learned
- **`guard()` only converts `ValidationError`, not plain `Error`** — a shared
  validator that throws plain Errors must be re-wrapped at the console-API
  boundary or the method throws instead of returning `{ error }`.
- **Canvas-center `PointerEvent` dispatch is the reliable way to click the
  model in Playwright** (the paint specs' pattern); `page.mouse.click` at
  canvas-relative fractions misses depending on layout/panel state.
- **Both sides of a merge adding the same import line produces a clean merge
  with a duplicate import** — TS catches identifier collisions but only at
  the next typecheck; grep for doubled imports after any same-area merge.

## Longed for
- **A cross-branch feature-collision check**: the staging-gate (or a daily
  job) could diff open PR branches' new exported symbols / SurfaceOpId-style
  enum additions and comment when two branches extend the same registry.
  Would have flagged the dual knurl days before the merge conflict did.
