---
date: 2026-06-06
branch: claude/bold-wozniak-HqQMD
files_changed:
  - examples/basic_shapes.js
---

## Human

The starter model for manifold-js is not flush with a build plate; one of the
models goes too low. Please fix.

## Assistant

The manifold-js starter (`examples/basic_shapes.js`, which doubles as the
landing-page `defaultCode` seed) is a four-demo sampler mounted on a tray base.
The build plate is the viewport's XY grid at z = 0, so "flush" means the model's
lowest point should be z = 0.

Traced each block's vertical extent and found two parts dipping below the plate:

- **Rounded box (demo 2)** — the convex hull of corner spheres has a z half-extent
  of `hz + r = 6.5`; with `translate([-8, 0, 5])` its bottom landed at **-1.5**, so
  the bottom corner spheres poked *through* the underside of the tray and below the
  plate. This is the "one model that goes too low." Raised it to `translate z = 7.5`
  so its bottom sits at z = 1, resting on the tray like the other three demos.
- **Tray base** — `cube([86,24,3], true).translate([2,0,1])` put its underside at
  **-0.5**, so even the base wasn't flush. Bumped the translate to `z = 1.5` so the
  tray bottom is exactly z = 0.

Verified with `npm run model:preview`: bbox min z is now **0** (was -1.5), and the
model stays a single watertight solid (`isManifold: true`, `componentCount: 1`) —
the demos still overlap the (now slightly taller) tray for the union. The only
remaining warning is the pre-existing sub-extrusion-detail note, unrelated to this
change. `npm run build` + `npm run test:unit` (718) green.
