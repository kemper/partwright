---
date: 2026-06-10
branch: claude/thing-model-library-spike-ponz7c
files_changed:
  - package.json
  - package-lock.json
  - src/geometry/geom2d.ts
  - src/geometry/engines/manifoldJs.ts
  - examples/geom_sketch.js
  - tests/unit/geom2d.test.ts
  - public/ai.md
---

## Human

Did I need to bring in the thi.ng geom? Could we have made those functions
ourselves? … Is there anything else from geom we could or should bring in
before merging this to main? Or, could we reimplement those other
shapes/functions as well? [Chosen direction: DIY + curate, drop dep.]

## Assistant

The spike's own finding was that `@thi.ng/geom` didn't earn its 45-package
footprint here: everything wired was elementary (trig loops + corner-cutting),
and the genuinely-hard 2D ops are already in the app — polygon booleans / hull /
offset / simplify on Manifold's `CrossSection`, smooth paths / sweeps / fillets
on the `Curves` namespace, and gear profiles on the `gears` namespace (which
landed on main during this work). thi.ng's one uniquely-additive capability,
Voronoi/Delaunay, isn't a sketch primitive at all — it's a separate feature
deserving its own spike.

So this change converts `api.geom` to a **dependency-free** primitive layer and
curates the surface to fill real gaps rather than duplicate the kernel:

- Reimplemented the original five (star/ngon/ellipse/roundedRect/smooth) in
  plain TS. `smooth` is hand-rolled Chaikin and cubic-B-spline subdivision
  passes.
- Added genuinely-missing, domain-useful primitives nothing else covers:
  `slot` (capsule, for slotted holes), `teardrop` (self-supporting horizontal
  hole for FDM — apex at r/sin(angle) where the roof tangents meet the axis),
  `annulus`, `sector`, `chamferedRect`.
- Deferred, by design, paths→`Curves` and gears→`gears`, documented in the
  ai.md entry so the namespace stays just the primitive-profile layer.
- Made `section()` orientation-safe with a shoelace CCW guard so every helper
  satisfies CrossSection's positive fill rule regardless of authored winding.

This also aligns with an existing repo convention I noticed: `noise.ts` and
`lsystem.ts` are dependency-free now but documented as thi.ng-compatible later —
same posture. If the sketch layer later needs tessellation/offsetting/Voronoi,
thi.ng can be reintroduced behind this stable `api.geom` surface.

Verified through the real manifold engine (`model:preview`): all primitives +
the smoothed revolve fuse into one watertight component
(`isManifold: true`, `componentCount: 1`). Unit tests rewritten to stub
`CrossSection.ofPolygons`/`circle` (12 cases, pure-logic tier). Build, madge
(no cycles), and knip (no new dead exports/unlisted deps) all clean; `@thi.ng/*`
fully removed from package.json and the lockfile.
