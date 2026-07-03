---
date: 2026-07-03
branch: worktree-agent-a355a9716bf9f686e
files_changed:
  - src/color/regionFit.ts
  - tests/unit/regionFit.test.ts
---

## Human

Implement a new pure-math module `src/color/regionFit.ts` that fits an
analytic shape (plane / circle-disc / sphere) to a detected mesh region's
boundary, plus unit tests. AI agents detect sculpted features (eye domes,
iris rings, pupils, blush dots) on imported character STLs via
crease-watershed segmentation; the detected triangle sets have ragged
tessellation-following boundaries that bleed when painted directly, so the
fix is to fit a clean analytic shape to the region and paint via the app's
smooth shape-selector machinery instead. Scope was pinned to this one module
plus its test file — no other files touched.

## Assistant

**Boundary detection**: `buildAdjacency`'s neighbor graph is CORNER-adjacency
(any two triangles sharing a welded vertex are "neighbors"), not edge
adjacency, so it can't answer "is this edge shared with another triangle in
the set." `boundaryPoints` builds its own welded-vertex-pair edge map (same
position-weld technique `buildAdjacency` uses) over the whole mesh, then for
each triangle in the target set checks whether any OTHER owner of each edge
is also in the set — if not, both endpoints go into the boundary set. This
correctly excludes a fan center whose spokes are all internal.

**Eigen decomposition without a cubic solver**: `fitPlane`'s normal is the
smallest-eigenvalue eigenvector of the 3x3 point covariance. Rather than a
closed-form symmetric eigensolver, I power-iterate on `(trace*I - C)`, which
is positive semi-definite for a covariance matrix, so its TOP eigenvector is
exactly C's smallest-eigenvalue eigenvector — converges reliably in ~64
iterations without solving a characteristic cubic.

**Kåsa fit + Coope sphere fit**: both are linear least-squares (3x3 for the
in-plane circle, 4x4 for the sphere) solved with a small Gauss-Jordan
eliminator with partial pivoting (`solveLinear`) that returns `null` instead
of propagating NaN through a singular system — this is what makes
`fitCircle3D` gracefully return `null` for exactly-collinear points (the
in-plane quadratic system's first column goes to zero) and `fitSphere`
return `null` for exactly-coplanar points (the z-coefficient column goes to
zero), with no special-casing needed for either degenerate shape.

**`best` heuristic — the key design bug caught by the fan-disc test**: my
first version normalized each fit's raw rms by its own feature size and took
the smallest, with a 20% circle-over-sphere tie preference per the spec.
That structurally can never let `circle` win against `plane`: `fitCircle3D`
reuses `fitPlane`'s exact center+normal, so `circle.rms² = plane.rms² +
meanRadialResidual²` — a circle's rms is *provably* >= the plane's, by
construction, regardless of how circular the boundary actually is. A literal
"smallest wins" therefore always picks `plane`, defeating the module's whole
purpose (the acceptance test — a 12-wedge triangle-fan disc — requires
`best: 'circle'`). Fix: score circle on the *isolated* radial residual
(`sqrt(circle.rms² − plane.rms²)`), which removes the shared out-of-plane
term and leaves only "how far from round." Even after that, an exact
synthetic disc still failed the tie check once: for machine-exact input, the
plane's rms sits at floating-point noise (~1e-19) while the circle's radial
residual is ~1e-8 (accumulated projection/solve rounding) — a *pure ratio*
tie-check blows up comparing two numbers that are both "zero" for any
practical purpose. Added an additive `ABS_TOL` floor (`candidate <=
best*TIE_FACTOR + ABS_TOL`) so both exact and ordinarily-noisy input resolve
the tie the same way. `sphere` needed no equivalent fix: for boundary points
that are exactly planar, its 4x4 normal-equations matrix has an all-zero
column (the z-coefficient), so `solveLinear` already reports it as singular
and returns `null` — the fan-disc test's `sphere` naturally comes back
`null` without any special-casing, leaving a clean circle-vs-plane contest.

Verified against `tests/unit/meshIslands.test.ts`'s `meshFromTriangles`
triangle-soup mesh-builder pattern (the spec's cited `meshIslands.test.ts`
turned out to be the correct file — an earlier worktree state before a
mid-task branch correction lacked it). All 7 spec test scenarios pass:
exact/noisy tilted circle, exact sphere, coplanar plane fit, fan-disc
boundary extraction, fan-disc end-to-end best-pick, and the degenerate
(<3/<4 points, collinear) no-NaN paths. `npm run typecheck` clean; full unit
suite (105 files / 1683 tests) green, no regressions.
