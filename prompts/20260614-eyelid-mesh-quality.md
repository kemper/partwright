---
session: "01DnBahfEetNH5Enmu5CbJPB"
timestamp: "2026-06-14T01:30:00Z"
model: claude-opus-4-8
---

## Human

On the two-lid PR preview the eyelids looked low quality up close: coarse
triangles missing along the lid edge, and iris colour stopping short of the
eyelid (white sclera gap). Asked to fix the mesh quality at the eye.

## Assistant

## Key decisions

**Instrumented the mesher instead of guessing.** Logged the marched edge length
per eye region. The iris/pupil were already fine (0.02–0.029) — the LID region
was marching at 0.106 (the coarse *mouth* detail sphere). Root cause: the eyelid
cap is a large region; at the fine eye edge it exceeds the per-region direct-fine
CELL BUDGET (the pad tips it over), so it falls back to the coarsest applicable
sphere → a faceted lid margin. The "missing iris colour" was that coarse lid
edge not aligning with the fine iris edge, exposing sclera.

**Fix: nested eye detail spheres + per-eye regions.** `faceDetail` now emits TWO
spheres per eye — a MEDIUM one (lid + eyeball, ~r.head·0.009) and a FINER, small
one (iris/pupil, ~r.head·0.0045). Tuned so the large lid/sclera regions skip the
fine sphere (over budget) and take the medium one (smooth margin within budget),
while the tiny iris/pupil regions pick the fine sphere (round discs). Also build
the eye parts PER EYE (separate same-named labels merged by `resolveLabelMap`),
so a both-eyes region can't blow the budget and force the coarse path.

**Clip iris/pupil with the half-space band, not the lid solid.** Subtracting the
lid solid (sphere ∩ tilted box) — a non-metric field — made `levelSet` mesh the
disc jaggedly. Intersecting with the opening band (flat box half-spaces between
the margins) keeps a clean field, the same no-bleed result, and aligns the iris
edge to the lid margin.

Verified at `--size 2400` (colour) and on the real ballerina (genus 1, +~10k
tris). Re-baked all 15 catalog figures; 154 unit tests pass.
