---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - public/ai/figure.md
---

## Human

(Continuing the figure-modeling architecture, #853.) "resume" — build pillar 2,
the invariant gate, so the failure classes (armor/belt on a limb, necklace through
clothing, loose pieces) are caught AUTOMATICALLY rather than by eyeball.

## Assistant

Built the invariant-check primitive: **`F.sharedSolid(a, b, opts?)`**.

The pipeline map had shown why a generic mesh-level overlap gate can't work — SDF
labels are exact but are OPEN surface patches (not boolean-able), and pure
overextension leaves no limb triangles to compare. So this works directly on the
SDF **fields**: it Monte-Carlo samples a deterministic grid over the two solids'
bbox intersection and counts points inside BOTH, returning `{ overlaps,
sharedVolume, point, samples }`. No closed mesh needed; works on posed bodies /
open patches / anything with `.evaluate`.

The key design move that makes it usable: you assert the SPECIFIC pairs that must
stay clear (`F.sharedSolid(belt, F.arms(rig))`), which sidesteps the
expected-overlap problem (clothing is SUPPOSED to overlap skin — a blanket gate
would false-positive on every garment).

Validated end-to-end on real figure geometry (not just the box unit tests): a
waist band wrapping the arms overlaps them by 125.8 units³; the same band through
`F.layers` with `occludeArms` drops to 10.6 — the gate both detects the bleed and
confirms the occlusion works (and reveals the capsule occluder leaves a small
shoulder/deltoid residual — precisely what the gate is for).

Documented in figure.md as the invariant battery (sharedSolid for must-stay-clear
pairs + the cheap unambiguous checks: maxComponents=1, nothing-below-base,
thumbAxis·up>0). The fully-automatic in-build gate (F.layers self-check) is left as
the next refinement in #853 — it needs a throw-vs-warn policy and a tolerance that
won't false-positive on the real-arm-vs-capsule-occluder residual this surfaced.
