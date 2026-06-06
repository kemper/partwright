---
session: "qAltr"
timestamp: "2026-06-06T13:15:00Z"
model: claude-opus-4-8
tools: [git, playwright, vitest]
---

## Human

I'd like Bambu-style plate-prep features: (1) select a model and automatically
align it to the floor/bottommost plane of the interactive view (lay-flat), (2)
auto-arrange disconnected components, (3) a new viewport menu to convert
components of one part into standalone parts in the part list. Plus any other
ideas. — After exploring, agreed to start with slice (1): drop-to-plate +
center. On write-back: "could we give the user an option? If we still have
parametric code, could we detect that and ask them which of the two they want
to do?"

## Assistant

## Key decisions

**Scoped to the first shippable slice (drop-to-floor + center on plate),** with
the split-to-parts and auto-arrange features deferred. The codebase already had
the spine for all three (full multi-part model + parts rail + merge modal;
`decompose()` + `listComponents`; the `commitSurfaceModifier` write-back seam;
`api.alignTo(…, {z:'min'})` math) — so these are UI surfaces over existing
primitives, which is why starting small was cheap.

**Two write-back modes with auto-detection, per the user's ask.** Manual paint
regions are stored as *world-space* descriptors (`coplanar` seedPoint, `slab`
offset, `box`/`cylinder` center, …) that re-resolve against geometry — so a
*parametric* translate would move the mesh but strand the paint anchors. Bake
mode is immune (it carries per-triangle colors, like the surface modifiers).
Hence the rule: `canPlaceParametric = manifold-js && no manual paint`. Model-
declared label colors re-resolve from the re-run code, so they don't block
parametric. `mode: 'auto'` picks parametric when safe, else bakes; an explicit
`'parametric'` on an unsafe model falls back to bake with a warning.

**Parametric write-back = wrap the source verbatim in a sync IIFE + append
`.translate([...])`.** The sandbox runs user code synchronously via
`new Function('api', …)` and requires a returned Manifold, so a sync arrow IIFE
is valid and the user's top-level `return` becomes the arrow's return. Code is
embedded *verbatim* (no re-indentation) so template literals aren't corrupted.
Repeated placements fold into one wrapper (deltas summed via a sentinel-matched
regex) instead of nesting; a cancelling fold returns the original inner code.

**No-op short-circuit.** Delta is computed from the bbox; an already-positioned
model (`|delta|` negligible *relative to size* — adaptive epsilon, no hard-coded
threshold) returns `{ok, noop}` without saving a junk version, which also avoids
pointless wrapper nesting.

**Bbox format gotcha.** The geometry-data `boundingBox` is `{x:[min,max], y, z}`
(see `statsComputation.ts`), not `{min,max}`. First implementation (and the
resize modal it was cloned from) read `.min/.max`; fixed `placementBox()` and the
panel summary to read `x/y/z`. (The pre-existing resize-modal read of `.min/.max`
looks like a latent bug — left untouched, out of scope.)

**Surfaces:** pure core in `src/surface/placement.ts` (unit-tested:
`tests/unit/placement.test.ts`), `applyTranslate` added to `modifiers.ts`,
host wiring + `partwright.placeModel()`/`canPlaceParametric()` in `main.ts`, a
`Place on plate` viewport panel (`src/ui/placeModal.ts`, cloned from the resize
panel) with command-palette entries and a `⤓ Place` Tools-menu button. E2E:
`tests/place-model.spec.ts` covers both modes, the no-op case, and the panel.

Verified: `npm run build` (tsc clean), `npm run test:unit` (702 pass),
`place-model` e2e (4 pass), lint:deps/deadcode clean. Manually exercised in the
browser (screenshots posted): a floating cone → Drop & center → grounded on Z=0,
centered, new parametric version saved.
