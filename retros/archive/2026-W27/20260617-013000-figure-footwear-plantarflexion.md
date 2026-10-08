---
date: "2026-06-17T01:30:00Z"
task: "fix: footwear plantarflexes with a lifted foot (no skin poke-through)"
pr: 711
areas: [figure, geometry]
cost: low
---

## Liked / Worked
- The defect localized fast from a code read: `buildFeet` had a `footPitchFrame`
  plantarflexion path; `buildFootwear` didn't. The `SoleFrame` doc-comment on
  `buildFeet` literally names this drift class ("footwear … guessing at where the
  foot meets the ground"), which pointed straight at the cause.
- The cleanest, lowest-risk fix was to feed `buildFootwear` the *same*
  `footPitchFrame` inputs and pivot about the *same* ankle — so foot and shoe stay
  concentric by construction, not by re-tuning. Gating it behind `if (pf)` kept
  the planted-foot flat path byte-for-byte unchanged (no re-bake regression).
- `bin/partwright.mjs compare` of feet-only vs shoes-only in a lifted pose was the
  single most convincing diagnostic — flat shoes next to pitched feet made the
  bug self-evident before any fix.
- The in-code `api.paint.label('skin'/'shoes'/'sole', …)` trick made colored
  before/after renders possible even though `model:preview` shades by normal and
  `build-catalog-entry.cjs` (real WebGL) wouldn't init in this container.

## Lacked
- `scripts/build-catalog-entry.cjs` failed with `FAIL [init]: API never appeared`
  under `xvfb-run` here — the documented colored-bake path was unavailable, so I
  fell back to `api.paint.label`. Worth noting the bake script is flaky/unusable
  in some remote containers.
- First regression-test grid was too coarse (step 0.6, narrow bounds) and passed
  on the *buggy* baseline — a false-green. Had to widen it (step 0.5, ±3/±4/±4)
  and re-verify it fails pre-fix. Lesson: always confirm a regression test FAILS
  on the unfixed baseline, not just that it passes after.

## Learned
- The two ankle-local-Z constants are *intentionally* different: `buildFeet` uses
  `ANKLE_LOCAL_Z = 1.81·foot` (its local z=0 is at `bottomZ = groundZ + 0.14·foot`),
  while footwear uses `A.z - groundZ = 1.95·foot` (its local z=0 is at `groundZ`).
  The 0.14 offset is exactly the 1.95−1.81 gap. Same pivot, different frame origin.
- When a foot-derived builder gains a pose transform, every `SoleFrame` consumer
  (`buildFeet`, `buildFootwear`, `buildBase`, `figure.standOn`) is a drift suspect
  — they share the frame precisely so they *won't* drift, but only if each one
  applies the same transforms.

## Longed for
- A structural guard against `SoleFrame`-consumer drift: a shared "place onto the
  (possibly pitched) foot" helper that `buildFeet`/`buildFootwear` both call, so a
  new pose transform can't land in one and not the other. Right now the pivot
  logic is duplicated in two builders; a future builder is one more place to miss.
- A repo-wide reminder that the time-based `catalog.test.ts` "rolling year window"
  assertion fails purely on wall-clock aging (o3-pro aged out mid-session and
  red-blocked every PR). Either anchor it to the snapshot's own generation date or
  drop it — a CI gate that breaks on a calendar tick is a recurring tax.
