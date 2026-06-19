# Retro — fixing figure-API geometry defects (PR #693, phase 2)

Context: user reviewed the 20 showcase figures, reported 5 defects (feet don't point,
jagged nostrils, deformed muscled back, asymmetric/missing eye, jagged eye discs).
I root-caused them in `src/geometry/sdfFigure.ts`, filed issues #701–#704 (+#691),
then fixed all five in the engine and re-baked.

## Liked / Worked
- **Four fix-agents in isolated worktrees, each owning DISTINCT functions, integrated via `git cherry-pick -n`.** Non-overlapping function edits to one 3400-line file auto-merged with zero conflicts; the only shared helper (`discAt`) was eye-local. Staging the union and committing once gave a clean single engine-fix commit.
- **The "no-op on the cases that already work" invariant** given to every agent was the right framing for editing a system with many consumers — planted feet stayed byte-identical, `muscle:0` byte-identical, normal faces unchanged — so the blast radius was bounded to the broken cases.
- **Bisect-by-removal found the danseur component split fast.** Browser said `componentCount:2`, SSR said 1, so I couldn't decompose headlessly — instead I re-baked danseur removing one part at a time (slippers → muscle:0 → nipples → eyes) until it went to 1. Five cheap bakes beat guessing.
- **Reviewing each worktree commit's diff scope before integrating** caught nothing bad this time but is the right safeguard — two agents had cross-leaked edits in their working trees and had to hand-stage only their own hunks.

## Lacked
- **Worktree isolation leaked uncommitted edits between agents.** Two of the four agents reported seeing a sibling's in-progress edits to `sdfFigure.ts` in their "isolated" worktree, and one was silently reverted mid-session by a stash/checkout interleave. They recovered by staging only their own hunks, but isolation that isn't actually isolated is a footgun for parallel same-file work.
- **The SSR-vs-browser `componentCount` divergence bit again.** The eye-clearance fix passed every agent's `model:preview` check (SSR: 1 component) but split danseur in the browser bake. Same class of bug as the earlier `coils`-hair islands. There is still no headless, browser-faithful component check.
- **A constant push floor (`r.head*0.16`) regressed small heads.** Raising the eyeball push to clear cheeks lifted danseur's smaller-than-floor eyeball (`r.head*0.14`) off its skull. A constant tuned on average heads silently breaks the extremes; the fix should have been a *measured* push from the start.

## Learned
- **`push_floor > eye_radius` ⇒ the eyeball's back pole exits the skull ⇒ browser component split.** The eye must always overlap the head core: `push < rad` (plus any anchor recess). Clearing a forward cheek must not exceed the eyeball's reach back into the head — otherwise enlarge the eyeball too.
- **Buried ≠ aliased**, again: a pupil that paints 0 triangles under a hooded lid + steep gaze is occluded, not under-meshed — meshing finer wastes triangles and doesn't fix it. (Viking: relaxed the one `pupil` gate rather than over-mesh a hooded eye.)
- **Re-baking the whole set after an engine change is mandatory** — the geometry changes for every figure, and per-figure browser-only regressions (danseur, viking) only show in the colored bake, never in unit tests or SSR.

## Longed for
- **Genuinely isolated worktrees** (or a documented "don't parallel-edit one file across worktrees" rule) so N agents can safely edit different functions of the same large module without leaking working-tree state.
- **A browser-faithful `componentCount` + paint-label check runnable headlessly** so an engine fix can be regression-tested against all catalog figures in seconds instead of a 20-minute xvfb re-bake — this is the single biggest time sink across both phases of this PR.
