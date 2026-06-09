---
date: 2026-06-09
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

I have an AI session working on a spike of sdf features leveraging thi.ng. I'd
like to have a parallel spike of a different feature using those model
libraries. Research and report back some options/proposals. [Then, after a
proposal menu:] picked the 2D sketch (geom) spike.

## Assistant

The SDF spike already on `main` (`src/geometry/sdf.ts`) explores thi.ng-style
*3D distance fields*. The most valuable distinct parallel was the thi.ng/geom
flagship as a **2D sketch layer** — Partwright has no real sketch layer today;
users hand-build `CrossSection.ofPolygons` vertex-by-vertex. So this spike adds
a thi.ng-backed `api.geom` namespace at the same architectural altitude as
`api.sdf`, but in the 2D→3D direction, giving a clean A/B of what thi.ng buys us.

Key decisions:

- **Plug into the existing namespace seam, not a new pipeline.** `api.geom` is a
  module-level singleton (like `Curves`/`meshOps`) built in `manifoldJsEngine.init()`
  and added to the sandbox `api` literal — it only needs `CrossSection`, so unlike
  `api.sdf` it doesn't need the per-run `label` closure. This keeps the whole
  engine-agnostic pipeline below the CrossSection boundary (booleans, extrude,
  revolve, paint, export) working unchanged.

- **Every helper returns a `CrossSection`** (XY plane, origin-centered) so results
  compose with each other and with native CrossSection booleans, and the existing
  `.extrude(h)` / `Manifold.revolve(cs, …)` paths just work. The bridge is one
  function: thi.ng `vertices(shape)` → plain `[x,y]` tuples → `CrossSection.ofPolygons`.

- **Surface area kept tight for a spike:** parametric primitives (`star`, `ngon`,
  `ellipse`, `roundedRect`, `fromPoints`) plus subdivision-curve smoothing
  (`smooth`, Chaikin/cubic) — enough to show the gap being filled without a sprawl.
  I probed the real thi.ng API in Node first to pin the actual signatures
  (`star(r, n, profile[])`, `subdivide(points, kernels[], closed)`) rather than
  guessing.

- **Validation matches the repo norm:** arguments go through the `assert*` helpers
  from `apiValidation` so console/AI callers get the same rejection-not-coercion
  behavior as the rest of the API.

Verified end-to-end through the real manifold engine headlessly
(`npm run model:preview -- examples/geom_sketch.js`): all four primitives + the
smoothed revolve fuse into a single watertight component (`componentCount === 1`).
Unit-tested the thi.ng→contour bridge by stubbing `CrossSection.ofPolygons` (keeps
it in the pure-logic vitest tier — no WASM). Documented in `public/ai.md` flagged
as a spike. This is intentionally a spike, not a finished feature: no UI
affordance, no `window.partwright` method, no in-app AI tool, no catalog
`.partwright.json` yet — those come if the spike graduates.
