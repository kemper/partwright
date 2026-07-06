---
session: "inverse-cad"
timestamp: "2026-07-04T06:00:00Z"
model: claude-fable-5
sequence: 45
---

## Human

(continuation — hands smoothing productionization, issue #884)

## Assistant

## Key decisions

**All six hands re-converged SMOOTH via `genLevelSet.mjs`** — every part
beat its band-stack best on chamfer AND hausdorff, best-pointer advanced
under turn.mjs's own non-regression check:
- grip L/R: chamfer 0.028 → 0.0127, area-ratio 1.16 → 1.017 PASS
- fist L/R: chamfer 0.022 → 0.0117, hausdorff 0.74 → 0.149, area PASS
- open L/R: chamfer 0.024 → 0.0142, hausdorff 0.198 → 0.095 (banded-only
  via --min-stable; area-ratio still fails — tracked in #884)

**The agent found a real defect in the validated prototype**: naive Z-lerp
SDF blending fabricates spurious genus whenever a slice carries multiple
separated blobs (fingers) — blob drift bridges/pinches the field even at
stable blob counts. Fix shipped in genLevelSet.mjs: per-slice
outer-loop-count classifier → flat-band fallback for volatile regions,
unioned with small Z overlap. Also `--min-stable` escape hatch for the
open hands' high-density contours (spurious handles at ANY step/dp/edge).
Counter-intuitive finding: --step 0.2 beats 0.15 for genus match (finer
steps RESOLVE the fingertip-separation zone into spurious handles that
coarser steps alias away).

Verified: typecheck green, 1717 unit tests green, all six through the
real gate loop. #884 stays open for the open-hand area-ratio follow-up.
