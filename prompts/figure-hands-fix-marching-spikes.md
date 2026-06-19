---
date: 2026-06-19
branch: claude/nice-dijkstra-xxdsz6
files_changed:
  - src/geometry/sdfFigure.ts
---

## Human

(With catalog screenshots) Lots of corruption on the hands — exploding spikes
at the fingers — and they look low-poly.

## Assistant

Reproduced (eventually): the spikes are POSE-DEPENDENT. My first repros used
`raiseSide: 90` arms and were clean; the real catalog figures (e.g. afro_funk,
`raiseSide: 150` overhead) exploded into spikes. Root cause: the jointed digit
built each finger from 3 capsule segments welded with a SMALL smoothUnion `k`
(fr*0.6). A small `k` between two capsules meeting at an angle makes a
near-degenerate, non-Lipschitz distance field; marching tetrahedra at the coarse
figure grid (hand edge ≈ 0.17) resolves that into orientation-dependent spikes —
so it only blew up at certain arm orientations relative to the axis-aligned
march grid. Finer resolution didn't fix it (the field is the problem, not the
sampling); fatter welds did.

Fix: enlarge the hand weld radii — digit joints fr*0.6 → fr*1.4, digit→palm
fr*0.5 → fr*0.85, thumb fr*0.6 → fr*1.0. The field stays smooth/Lipschitz, the
hand is clean at any pose, and the joints remain subtly present (the curl still
works for `relaxed`). Verified the exact failing case (full afro_funk) in BOTH
model:preview (Node) AND the real browser (renderViews) — raised hand is clean,
fully-separated, no spikes. Relaxed/open/fist all clean. 250 figure tests still
pass; preflight green.

Note on what the user was seeing: the catalog/editor re-runs the figure CODE, so
the branch-preview render used my new hands; the spikes were real (my code), not
stale bakes. The verification lesson: test the hand at the WORST pose (overhead,
twisted arms), not one convenient pose — orientation-vs-grid is a real variable
for smoothUnion-dense SDF features.
