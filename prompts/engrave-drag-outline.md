---
session: "01NTQB"
timestamp: "2026-06-10T16:30:00Z"
---

## Human

On my last test with the mansion/manor model in the catalog, it did not
preserve the colors. I also didn't see it show up? It would be nice if rather
than having a button for what face to put it on I could see the text being
dragged around in realtime as an outline like we do when we have paint
operations showing brush size.

## Assistant

## Investigation

Reproduced on the catalog's Country Manor Estate (an `api.labeledUnion` with 8
model-declared colors, 81 units wide). Found three distinct problems behind the
two symptoms:

1. **"Didn't preserve colors" was the *preview*, not Apply.** Apply carried
   colors fine (8 regions). But `previewSurfaceModifier` ignored `preserveColor`
   and showed the bare carved mesh — texture modifiers carry `triColors` so their
   previews stay colored, but engrave/voronoi-lamp bake a color-less mesh, so the
   live preview rendered every triangle the default blue. Reads as "it wiped the
   colors."
2. **`modelSpan`/`modelBBox` read the wrong shape.** `getGeometryData().boundingBox`
   is `{x:[lo,hi], y, z, dimensions}`, but both helpers read `.min/.max`, so they
   silently fell back (span→10, bbox→±5 cube). On the 81-wide manor the default
   text size came out ~7 (tiny → invisible) and click-placement fractions were
   garbage. Pre-existing bug affecting every model.
3. **Top-face default** put the text on the sloped roof where you'd never see it.

## Key decisions

**Live drag outline (the headline ask).** Mirrored the image-stamp preview
(`src/color/imagePaintUI.ts`): a new leaf overlay module
`src/surface/engravePlacementOverlay.ts` owns a `THREE.LineLoop` (depthTest off,
vivid magenta so it reads on any surface color) added to `getScene()`. In place
mode, a `pointermove` listener on the canvas raycasts via `pickFace` and floats
the outline at the hit (nearest axis face + posU/posV); the corners come from a
new pure `engravePlanarFootprint` in `engraveStamp.ts` that mirrors
`engraveCombine`'s center/rotation math, so the outline lands exactly where the
carve will. Clicking drops it (commits to the sliders + re-previews). The outline
also tracks the position/rotation sliders. Disposed on panel close.

**Colored preview.** `previewSurfaceModifier` now honors `preserveColor`: for a
re-meshed manifold result with no `triColors`, it transfers colors from the
result's `colorSource` by nearest-triangle map, carrying the `_painted` mask so
unmapped triangles fall back to the default material (no black gaps) — works for
full label-color models and partial paint alike.

**BBox fix.** A single `modelBBox` now handles both `{x,y,z}` and `{min,max}`
shapes; `modelSpan` derives from it. Fixes text sizing and click-placement on all
real models.

## Verification

- Browser (manor): preview shows buff/slate colors with the carve; size default
  56.7 (was 7); magenta outline follows the cursor; clicking the facade sets
  "Face: Front (−Y) · placed by click".
- Unit: `engravePlanarFootprint` (center/posU/aspect/lift/rotation). E2e: place
  mode click sets the face readout. Full unit (998) + engrave/voronoi e2e green;
  `lint:deps` acyclic (new overlay module is surface→renderer, no cycle).
