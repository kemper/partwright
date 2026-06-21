---
session: "busycray"
timestamp: "2026-06-21T14:34:54Z"
model: claude-opus-4-8
sequence: 4
---

## Human

I have another session making animals and another making accessories for the
figure API. Could they benefit from this eval loop if I merged it soon? Also, do
I need to gather style reference images (e.g. chibi for the animals)?
[Chose: generalize the harness now; merge once e2e is green.]

## Assistant

## Key decisions

**Generalized the figure-named harness to a subject-neutral one** so the
incoming animals + accessories sessions build on a neutral foundation instead of
adding cases under a `figures/` path (cheap rename now vs. multi-branch pain
after three branches reference it). The harness was already subject-agnostic —
it judges any model the preview path can build (manifold-js / voxel / scad, not
BREP) against a per-case rubric — so this was a pure rename, no behavior change:

- `scripts/eval-figures.mjs` → `scripts/eval-models.mjs`; `npm run eval:figures`
  → `eval:models`.
- `evals/figures/{cases,baseline.json,README.md,results}` → `evals/{cases,...}`
  (dropped the `/figures/` layer). Path constants, `.gitignore`, and the README
  (now "Model-quality eval corpus," with an "add an animal/accessory case"
  section) updated. Fixed two stray `eval:figures` strings in `judge.mjs`.
- Re-verified: `eval:models -- shoulders --judge pixel` → 100/100, exit 0,
  baseline resolves at the new path.

**Advice captured in the README, not just chat:** accessories benefit most
(same rig/API/engine/paint — just add cases + rubrics); animals benefit as a
quality gate (engine-agnostic judge grades whatever they build). On references:
you don't need images to *start* — a style rubric ("chibi: head ~40–50% of
height, oversized eyes, stubby limbs") gets the judge far, and the loop runs
reference-free (rubric-only) today. But for subjective *style fidelity*, a small
*consistent* pinned reference set is the high-leverage input (matches CLAUDE.md's
"get the visual target before iterating"); `generate-reference-images.cjs` turns
one photo into matched views to feed a case.
