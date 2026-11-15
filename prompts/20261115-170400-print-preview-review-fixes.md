---
session: "5ecjfq"
timestamp: "2026-11-15T17:04:00Z"
sequence: 12
---

## Human

Proceed with the layer-colour print preview using best judgement; the owner
will test what gets built. (This commit acts on the review pass over that
work: one blocking finding, seven should-fix, six nits.)

## Assistant

**Blocking: layer colours went stale on an object switch.** Only a fresh run
set `currentLayerColors`; restoring an object from the mesh cache left the
previous object's spec live, so its bands were previewed on the wrong object
and, worse, written into the other object's 3MF (dropping that object's
paint). The cache entry now carries the spec, both write sites fill it, and
the cache-hit branch restores it and tells the open panel.

**The preview and its panel now always go together.** A preview turned on from
the API left no visible state and let Paint pick triangles off the re-split
preview mesh. Rather than special-casing each picker, `setPrintPreview({enabled})`
opens/closes the panel, so the existing tool-panel exclusivity turns the
preview off when any other tool opens. It refuses before the first run.

**One display helper.** `showModel()` replaces the direct `updateMesh` calls
that put the model back on screen (version load, live transforms, animation
restores, paint API), so the viewport and `renderView` agree while the preview
is on. Tool-owned temporary previews keep calling `updateMesh`.

**Draft scoping.** The panel's unsaved draft is keyed on session + object and
dropped as soon as another one is on screen, so it can't be previewed on, or
applied to, a model it wasn't written for.

**Cut on a step.** Faces and edges lying exactly on a layer top left no cut
segments, so a stepped model got a hole under the upper feature while
reporting `capped: true`. The cut now runs a hair below the layer top (so
everything on the plane is cleanly above it) and what is kept is drawn at the
layer top. Loops that close are capped even when another is open.

**Slider speed.** The builder is split in two: `splitMeshByBands` (band split
and colours; kept between slider moves) and `cutBandMesh` (the slider). Typed
arrays, a binary search over the planes, a fast path for triangles inside one
band and per-layer colour tables. 200k triangles: about 430 ms per slider step
before, about 30 ms now; 2M triangles about 100 ms. A Worker was not needed at
these numbers, so it stays on the main thread.

**Empty declarations.** `layerColors([])` used to become one grey band and
strip the object's paint on export. It now means "none" everywhere:
`setLayerColors([])` removes the call, the run records nothing, and the
exporter ignores an empty spec.

**Export notices.** Split objects, the publish path and the plain single-mesh
3MF now say when layer colours are left out instead of dropping them silently.

**Left as is:** `lexicalMask` stays in `surfaceCodegen` (the editor already
imports it from there; moving it is a separate refactor). Verified with the
real slicer on an app export (9/9 checks, 3 layer changes).
