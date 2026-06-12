---
date: "2026-06-11T20:30:00Z"
task: "4-subagent figure-API audit → fix cluster (spine/tilt/eyes/bald/brows, PR #593), catalog rebake (#596), rocker guitar redesign (#598)"
areas: [sdf-figure, catalog, subagents, verification, bake-tooling]
cost: high
---

## Liked / Worked
- **Four parallel audit subagents over one ~1300-line module, partitioned by
  region** (rig/FK · body/weld · face · hair-clothing-catalog) found a deep,
  deduplicated bug list fast. Two agents independently flagged the inert `spine`
  — that cross-confirmation made it the obvious #1 to fix.
- **Reconciling the audit against `origin/main` before writing code** caught that
  PR #588 had already fixed one finding (the arm-hinge) and, more usefully,
  showed the precedent (leg-twist's "parsed-but-never-read" fix) that justified
  the spine fix and its test shape.
- **A `spineActive` identity guard** made the riskiest change (rewriting the
  return of the most safety-critical function) provably zero-impact for every
  existing pose — all 63 prior tests passed unmodified, which was the whole
  confidence story.
- **Probing `rig.joints.handL` across a pose grid to place the rocker's fretting
  hand deterministically** finally cracked a pose two model-sculpt agents had
  been circling — numbers over eyeballing the mirrored front view.

## Lacked
- **Two model-sculpt rounds burned ~180k agent tokens on the rocker and still
  left the fretting hand splayed**, because reasoning about arm FK from a
  mirrored front view is genuinely hard. The win only came when I dropped to a
  joint-coordinate probe. A "where does this pose put the hands?" helper would
  have saved both rounds.
- **`build-catalog-entry.cjs` still hardcodes `headless:false`** and only works
  under `xvfb-run`. Known since the June retros; every rebake session re-derives
  the `xvfb-run -a node …` incantation. It should detect a display or document
  the wrapper in its own `--help`.

## Learned
- **Activating a previously-dead DOF can degrade figures tuned around its being
  dead.** Karate's deep stance at the authored `spine.lean 7` jumped genus 2→6
  once spine went live (the leaning torso grazed itself); lean ≤6 stays genus 2.
  Any "make a no-op real" change needs a catalog genus sweep, not just a render.
- **The bake's `--max-genus` gate is what caught that** — it would have rejected
  the genus-6 karate. Gates earn their keep on exactly these second-order effects.
- **The audit's "documented DOF that silently no-ops" was a *class*, not a
  one-off:** spine AND head.tilt were both dead the same way leg-twist had been.
  Worth grepping for other parsed-but-unread option fields.

## Longed for
- **A `figure.poseProbe(rig)` / `model:preview --joints` that dumps world joint
  positions** (hands, elbows, feet) as JSON. I hand-rolled a `throw new
  Error(JSON.stringify(...))` scratch twice; first-class joint readout would make
  pose authoring deterministic instead of a render-guess loop.
- **A catalog-wide `--max-genus` regression sweep** (one command that rebakes/checks
  all figure entries and flags any genus increase vs the committed entry), so a
  geometry-or-engine change's effect on the whole catalog is one run, not nine.
- **`build-catalog-entry.cjs --help` documenting the `xvfb-run` requirement** (or
  auto-wrapping), to stop every catalog session re-discovering it.
