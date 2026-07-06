---
session: "inverse-cad"
timestamp: "2026-07-03T22:30:00Z"
model: claude-fable-5
sequence: 33
---

## Human

Loved the results; asked to see the levelSet SDF interpolation approach
demonstrated, and attached all_armor_parts.3mf — "are you able to extract
what you need from those?"

## Assistant

## Key decisions

**3MF extraction**: parsed the ZIP's 3D/3dmodel.model XML directly
(objects, component references, build transforms; part names from the
Slic3r_PE_model.config), deduped the "2x" duplicate instances, applied
build transforms, normalized each part to print orientation (XY-centered,
z floor 0). 16 unique armor parts → `.plans/inverse-cad/armor-stls/`
(checked in — same treatment as the frame corpus, CC-BY-4.0).

**levelSet SDF-interpolation demo (issue #884's option 1) validated
empirically on hand_grip_left**: slice the target at 0.15mm, DP-simplify,
embed the 53 measured section polygon sets in the candidate, define
sdf(x,y,z) = z-lerp of the 2D polygon SDFs (positive inside, flat caps via
min with plane distances), mesh with `Manifold.levelSet` at 0.11 edge
length. Results vs the shipped band stack: chamfer 0.028 → **0.0093**,
hausdorff 0.287 → 0.270, volume ratio 0.994, visually SMOOTH (domed
fingers, no staircase), ~6s build. Remaining for productionization: add
the two debris-shell voids explicitly, re-run full gates, apply to all six
hands, re-bake the catalog entry.

**Comparison-constant trap (self-caught)**: initially judged the levelSet
volume 7% low by comparing against the OPEN hand's volume (364) instead of
the grip's (340.26) — the real ratio was 0.994. Verify the reference
before judging the measurement.
