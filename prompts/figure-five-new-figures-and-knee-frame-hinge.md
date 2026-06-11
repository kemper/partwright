---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - examples/figure_sitting_reader.js
  - examples/figure_karate.js
  - examples/figure_princess.js
  - examples/figure_rocker.js
  - examples/figure_superhero.js
---

## Human

(Same session.) Stage 5: five new catalog-quality figures exercising the
round-6 capabilities, per the user's request to "create 5 new catalog
entries utilizing the new capabilities combined with past capabilities."

## Assistant

Five figures, each delegated to a model-sculpt agent for the visual
iteration loop (I wrote the initial drafts; agents owned render→adjust):
sitting reader (chair-sit + book + bangs), karate master (front-stance
punch + gi/belt/headband + fists), princess (gown + crown + ponytail +
lips + wave), rock guitarist (guitar bridged to both hands + bangs +
singing mouth), superhero (sky-punch + cape + emblem + boots/gloves).

The reader exposed a third FK hinge bug in the same family: cross(dir, fwd)
for the knee degenerates toward a VERTICAL axis as flex → 90 with any
nonzero abduct (the small abduct component dominates the cross product), so
the documented chair-sit pose frog-sat sideways. Fixed by deriving the knee
hinge from the thigh's own frame — the rest hinge [−1,0,0] carried through
the same abduct/flex rotations as the bone. Verified by hand that this is
numerically identical to the old hinge wherever abduct or flex ≈ 0, which
covers every existing example pose; the arm hinge is left as-is
deliberately (all arm poses were just re-tuned and arms have the explicit
`twist` roll DOF) — noted as a known asymmetry.

Genus diagnosis on the reader followed the bisect discipline: variants
without book/bench/fingers pinned genus 23 entirely on the book (book+skin
alone reproduced 22). Root cause: a book narrower than the hand span
leaves its side faces kissing the fingertips at near-tangent angles — a
micro-handle factory. Fix: widen the book past the hand span so its faces
cross the palms transversally. Final: 1 component, manifold, genus 1.
