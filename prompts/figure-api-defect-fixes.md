---
date: 2026-06-16
branch: claude/adoring-lamport-gmg9mn
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - tests/unit/sdfFigure.test.ts
  - public/catalog/*.partwright.json (re-baked)
---

## Human

[On PR #693, after a defect review of the 20 figure-showcase catalog entries.]
Fix the API defects in this PR and rebake.

## Assistant

Fixed the five figure-API defects surfaced in the #693 review (filed as #701, #702,
#703, #704, and #691) directly in `src/geometry/sdfFigure.ts`, then re-baked all 20
catalog entries against the fixed engine.

Because all five touch one 3400-line file, I parallelised across **four isolated git
worktrees**, each owning non-overlapping functions, then cherry-picked the four
commits onto the branch (clean auto-merge — the only shared helper, `discAt`, is
eye-local). Guiding invariant for every fix: **be a no-op on the cases that already
work**, only repair the broken ones, to bound regression blast radius across a system
with many consumers.

- **#701 feet** (`footPitchFrame`/`buildFeet`/`buildFootwear`): a foot lifted clear of
  the ground plane now pitches to follow the lower-leg bone (plantarflexion / toe-point);
  planted feet run the original code untouched. Footwear soles became footprint-shaped
  capsules instead of jagged overhanging slabs. **Known gap:** only the *bare* foot
  plantarflexes — the shoe *upper* was out of scope, so shod raised feet still lie flat
  (filed as a follow-up against #701).
- **#691 + #703 eyes** (`buildEyes`): raised the eyeball clearance floor to
  `max(rad*0.28, r.head*0.16)` so neither L/R-symmetric eye sits at the burial threshold
  (kills the asymmetric one-eye result); rebuilt the iris/pupil as a forward-seated ball
  whose visible boundary is a clean radical circle, not a slivered concentric cap.
- **#703 face** (`buildNose`/`buildBrows`/`buildMouthPart`/`buildNipples`/`faceDetail`):
  auto-skip the nostril carve below a tip-radius floor (small/chibi noses) + finer nose
  detail; brows and the carved lip line rebuilt as smoothUnion chains (no frayed strips);
  areola rim beveled; new `faceDetail` nostril + chest detail regions.
- **#702 + #704 muscle/garment** (`buildTorso`/`buildPants`/`buildTop`): muscle back
  masses are now built in the figure's rest frame and rigidly re-rotated by the spine
  lean, so they ride the bent torso instead of tearing into a twin-lobed bulge;
  `muscle:0` stays byte-identical. Garment waist/hem cuts softened from hard `intersect`
  to a thickness-scaled `smoothIntersect`.

A shared-checkout quirk surfaced: the worktrees leaked each other's uncommitted edits,
so each agent staged only its own hunks (verified: zero cross-contamination in the four
commits). Integrated: typecheck clean, `npm run test:unit` 1439/1439 green (incl. the
figure-eye geometry tests + 6 new nose/face tests), all 20 entries re-bake to one
watertight component with every paint label resolving.
