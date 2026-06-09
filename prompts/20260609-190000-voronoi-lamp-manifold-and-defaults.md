---
session: "fc5979"
timestamp: "2026-06-09T19:00:00Z"
sequence: 4
model: claude-opus-4-8
---

## Human

Trying the lamp on a 30-radius sphere — hard to get settings that look as good
as the demo, and it's generally producing non-manifold objects. Would love a
"guarantee manifold result" option. Ideas?

## Assistant

Two root causes, both fixed:

## 1. Defaults were too coarse + resolution was a footgun

Defaults scaled off the 3D bbox diagonal, which over-weights a sphere (r30 →
diagonal ~104 → default cell ~17 → only ~3 cells across, sparse/ugly). Retuned
(cellSize ~diag·0.1, wallThickness ·0.04) and added an **auto-resolution floor**:
resolution is raised so struts always resolve to ≥ MIN_STRUT_VOXELS (6) across,
which is the single biggest lever for both looks and manifoldness. The user
rarely needs to touch resolution now.

## 2. "Guarantee manifold" — what actually worked

The non-manifoldness comes from the cube mesher's documented caveat: voxels
touching only across a diagonal make a non-manifold edge. I first tried a
well-composedness repair (fill diagonal gaps). **It made things worse** — A/B in
the headless loop showed watertight-OFF = 1 component/manifold, watertight-ON
(repair) = 4 components. Since the repair only *adds* cells it can't disconnect,
so it was introducing new diagonal configs faster than it fixed them; Manifold
then split the residual non-manifold edges into multiple (still-manifold) pieces.
Deleted it.

What works instead: **keep only the largest face-connected (6-connectivity)
component** + the thicker struts from the auto-resolution floor. 6-connectivity
is exactly what meshes into one watertight solid, and the strut web of a closed
shell is always one dominant component (everything else is cut-off debris that
would print as loose bits). Verified manifold=true, componentCount=1 on sphere,
cube, and cylinder with pure defaults. Also dropped mesh smoothing from 12→5
Taubin iterations (12 was pinching thin struts apart, which splits the piece).

The `watertight` option (default on) now gates this keep-largest pass; off keeps
the raw multi-part cut. UI checkbox relabeled "One connected piece (printable)".

## Lesson

The fancy fix (well-composed repair) was both buggy and unnecessary; the simple,
verifiable one (keep largest 6-connected component + adequate strut thickness)
gave the actual guarantee. The headless A/B (watertight on vs off, mesh vs voxel
component counts) is what surfaced that — would not have been visible without
rendering/measuring each variant.
