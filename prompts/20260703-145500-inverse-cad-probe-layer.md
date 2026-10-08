---
session: "inverse-cad"
timestamp: "2026-07-03T14:55:00Z"
model: claude-fable-5
sequence: 8
---

## Human

(continuation — same directive: build the v2 generic inverse-CAD framework at
high quality; subagent infra was down so build proceeded inline)

## Assistant

## Key decisions

**probe.mjs — "measure, never estimate."** Every question a part-agent used
to answer by squinting at a render is now one CLI call with a numeric answer:
`bbox` (incl. volume, PCA, symmetry, Euler-characteristic genus), `section
--fit` (contours + circle/rounded-rect fits with honest residuals), `bands`
(contour-stability banding along an axis + prismaticScore), `fit --near`
(local RANSAC plane/sphere/cylinder), `ray`, `profile` (r(z) + revolveScore).

**slice.mjs** is the shared kernel: plane slicing with a consistent
on-plane tie-break, segment chaining into closed contours, hole
classification by containment parity, Kåsa circle fit, rounded-rect SDF fit,
closed-loop Douglas-Peucker, greedy short-edge cleanup (the manifold
extrusion-width trap).

**trace2code.mjs validated the deterministic-bootstrap thesis**: tracing the
ankle at z=1.0 and emitting fromPoints+extrude code scored chamfer 0.066 /
hausdorff 0.44 — byte-for-byte the same score as the hand-converged ankle-v5
that took a subagent a whole session. One command replaces the agent's
entire silhouette phase on prismatic parts.

## Bugs found while testing

- A ray through a face diagonal registers in both sharing triangles →
  cmdRay dedupes coincident hits (agents probe symmetric centers constantly).
- Euler-characteristic genus needs matched vertices: a procedural test mesh
  with T-junctions (annulus edges unsplit on the outer wall) inflates E and
  skews χ. Test uses a proper square torus; noted as a caveat for genus on
  sloppy real-world STLs.
