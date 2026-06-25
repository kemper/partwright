---
session: "keen-wozniak"
timestamp: "2026-06-21T01:50:00Z"
---

## Human

I was doing an edge smoothing painting operation and a huge triangle showed up
that was not painted. [Screenshot attached: a brown painted loop on a dark
pyramid face with a sharp dark unpainted triangle inside the loop.] Investigate
and fix if you're confident you can.

[Later, after I asked for a reproduction] Shared the `.partwright.json` session.

## Assistant

## Key decisions

**Reproduced from the real session before changing anything.** Four synthetic
reproductions (flat grid, huge single triangle, tilted face, grazing contour,
concave two-lobe footprint) all showed the pipeline behaving correctly — I could
not manufacture the bug, so I asked for the session rather than blind-patching a
subtle, heavily-tested geometry path. The session was the key: model is
`Manifold.cylinder(22,14,0,4)` — a square pyramid with **6 triangles total**,
each slanted face a single ~25-unit triangle — painted with a looping
edge-smoothing brush (radius 1, `maxEdge` 1/64). Running the real engine + real
refine pipeline against the real stroke descriptors reproduced a triangle at
**area 3.73 / edge 3.26** that was fully inside the footprint yet unpainted.

**Root cause: "all 3 vertices inside" ≠ "interior inside" for a concave
footprint.** A brush footprint is the union of disks along the stroke path, so a
looping/curved stroke is concave. Across a coarse triangle spanning the concave
side, the signed-distance field dips inside at all three corners but bulges back
*outside* in the middle (confirmed: vertices `f = -0.24, -0.50, -0.50`, centroid
`f = +0.19`). `brushClassifier` returned `'inside'` on the 3-vertices test, so
`selectByClassify` never subdivided it; then `strokeFootprintTriangles` resolves
paint by **centroid**, which scored outside → the big triangle rendered
unpainted, sitting inside the painted ring.

**Fix (minimal, in `brushClassifier`):** when all three vertices are inside, also
sample the interior — centroid + the three edge midpoints. If any pokes outside
the footprint, classify it as `'straddle'` instead of `'inside'`, so it
subdivides down to `maxEdge` and the concave boundary resolves cleanly. This
mirrors the existing midpoint-sampling pattern in `selectByClassify`'s
straight-boundary test, is a no-op for genuinely convex interiors (the common
case — no extra subdivision), and self-heals geodesic-gate granularity too since
`withinFootprint` already returns false for unreachable points. Triangle count
rose ~16% on the repro, bounded to the concave boundary band.

**Verification.** Confirmed via real-session reproduction (3.26 → 0), a
before/after colored render (the dark triangle inside the loop disappears), all
1558 unit tests, and the existing smooth-brush / coverage / paint-in-code /
surface-in-code e2e specs. Added `tests/paint-buried-triangle.spec.ts` — an
engine-backed e2e regression (the geodesic field + slab normals need the real
meshed pyramid, so it can't live in the pure unit tier) that runs the actual
pipeline in-page against a trimmed fixture and asserts no large
inside-but-unpainted triangle survives. It fails without the fix (3.26) and
passes with it.
