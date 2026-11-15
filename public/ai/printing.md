# Print Readiness

Informational tools for checking whether a model is ready to print, plus the
shared **printer profile** (build volume + nozzle) that drives those checks.

Scaling and splitting live in their own dedicated tools — this subdoc covers
the read-only print-readiness side.

## Printer settings

`getPrinterSettings()` → `{ bed:[x,y,z], nozzleWidth, overhangAngleDeg, clearance }`
(mm). `setPrinterSettings({...})` updates any subset.

When the user names a printer, set the bed:

| Printer | bed |
|---|---|
| Bambu X1 / P1 | `[256,256,256]` |
| Bambu A1 mini | `[180,180,180]` |
| Prusa MK4 | `[250,210,220]` |
| Ender 3 | `[220,220,250]` |
| Prusa Mini | `[180,180,180]` |

```js
partwright.setPrinterSettings({ bed: [220, 220, 250], nozzleWidth: 0.4 });
```

## checkPrintability(opts?)

Run this **before telling the user a model is print-ready**, and again after any
geometry change. It returns a structured report; every entry in `checks[]` has a
`level` of `pass` / `warn` / `fail` (a `fail` means it won't print as-is).

What it inspects:
- **Bed fit** — bounding box vs the build volume (fail = too big → call
  `scaleModel(sx, sy, sz)` to shrink, or the Split tool to cut into bed-sized
  pieces).
- **Overhangs** — downward faces shallower than `overhangAngleDeg` (default 45°
  from horizontal) that will need support. Re-orient with `rotateModel` /
  `layFlatModel` to remove them.
- **Thin walls** — a *sampled* interior-ray estimate of the thinnest wall vs the
  nozzle (fail < 1 nozzle width, warn < 2). It's an estimate, not exact — to
  see **where** the walls are thin, use [`thicknessMap()`](#thicknessmapopts).
- **Small features** — smallest overall dimension near the nozzle limit.
- **Stability** — centre of mass vs the base footprint (warn = may tip over).
- **Watertight** — non-manifold / render-only geometry won't slice (fail).

```js
const r = partwright.checkPrintability();
// r.ok === false → read r.checks, fix the `fail` items, re-check.
```

## thicknessMap(opts?)

The exact counterpart of the thin-wall check: it measures the wall under
**every** triangle (a ray straight through the solid to the opposite wall), so
you learn *where* the walls are thin, not just that some sample was.

```js
const t = await partwright.thicknessMap();          // threshold = 2 × nozzle width
// t.minThickness, t.thinnest        — thinnest wall and where it is
// t.medianThickness                 — typical wall
// t.thinArea, t.thinFraction        — how much surface is below threshold
// t.spots[]                         — connected thin areas, thinnest first:
//   { center, thinnest, thickness, area, triangleCount }
const h = await partwright.thicknessMap({ threshold: 1.2, render: true });
// h.image — heatmap: red ≤ ½·threshold, yellow at threshold, grey ≥ 2·threshold
```

Thicken exactly the spots it lists (e.g. `api.shell` with a larger
`thickness`, or add material near `spot.center`), then re-run it. "Thickness"
is the local wall of a shell, or the through-diameter of a solid. Each
triangle is measured at its centroid, so a part made of a few huge triangles
(a flat box face) reads as that face's middle; organic and remeshed surfaces
have plenty of triangles. Triangles whose ray finds no opposite wall (an open
mesh) count as `unmeasured`. A sharp edge (a shell cut off at an angle, a
blade) correctly reads as thin: it is fragile in print. The first call costs
about 1.5 s per 250k triangles; later calls on the same mesh (a new
`threshold`, `render`) reuse the measurement.

Then fix problems at the source: thicken walls, edit the dimension constants in
the model code (preferred for parametric models), or apply a transform directly.
You can drive orientation and sizing yourself — no need to hand off to the UI:

- `scaleModel(sx, sy, sz, { mode, preserveColor })` — resize by per-axis factors
  (1 = unchanged). Use a uniform factor to shrink an oversized model onto the bed.
- `placeModel({ dropToFloor, centerX, centerY, centerZ, mode })` — sit the model
  on Z=0 / center it on the bed.
- `rotateModel({ x, y, z, mode })` — rotate by Euler degrees about the model's center.
- `layFlatModel({ mode })` — auto-orient the largest flat face onto the bed and drop it.
- `mirrorModel({ axis, mode })` — mirror across the `'x'` / `'y'` / `'z'` plane (e.g. to make a left/right pair).
- `previewScale(sx, sy, sz)` — show a non-destructive viewport preview of a resize without saving a version (call `clearSurfacePreview()` or re-run to restore); commit it with `scaleModel`.

Each saves a new version and returns `{ ok, geometry, warnings? }`. `mode`
(`'auto'` default / `'parametric'` / `'bake'`) controls write-back: on a
manifold-js model `'auto'` stays **parametric** — it wraps the source in the
matching `.scale(...)` / `.translate(...)` / `.rotate(...)` call so the model
stays editable. On a SCAD or BREP/replicad model (or a manually-painted one)
these **bake the model to a manifold-js mesh** (the warning says so) — the
parametric source and STEP export are then gone, so prefer editing the source
for parametric models when you can. Use the Split tool when a
model is too big to print in one piece even at scale.

## Colours by layer height

A model can print in different colours at different heights: the printer
switches filament at a layer, as you would set on a slicer's layer slider. In a
manifold-js model, declare it in the code:

```js
api.print.layerColors([
  { z: 0, color: '#ffffff' },   // from the bed up: white
  { z: 8, color: '#d01e1e' },   // from 8 mm up: red
  { z: 14, color: '#1e50dc' },  // from 14 mm up: blue
]);
```

- Each entry means "from height `z` (mm above the bed) up, print in `color`".
  The bed is the model's lowest point. An entry at `z: 0` sets the colour of
  the first layers; without one they print in the default grey filament.
- Heights snap to the nearest layer boundary. The layer height comes from the
  app setting (0.2 mm by default); a model whose design depends on thin layers
  can set its own: `api.print.layerColors(changes, { layerHeight: 0.12, firstLayerHeight: 0.2 })`.
- Last call wins. Unknown keys are rejected.

From the console or an agent, the same thing without editing code by hand:

- `await setLayerColors([{z, color}], {layerHeight?, firstLayerHeight?}?)`
  writes (or rewrites) the call in the open object's code, runs it and saves a
  version. Returns `{ok, call, replaced, version?, layerColors}` or `{error}`.
- `await clearLayerColors()` removes the call.
- `getLayerColors()` returns `{declared, changes, layerHeight,
  firstLayerHeight, modelHeight, totalLayers, bands, warnings?}`. `bands` is
  what actually prints after snapping: `[{color, fromZ, toZ, firstLayer,
  lastLayer}]`, with 1-based layer numbers.

**Layer colours and paint don't combine on one object.** A slicer ignores
layer colour changes on an object that carries per-triangle paint. When an
object has both, `getLayerColors()` says so in `warnings`, and the 3MF project
export writes the layer colours and leaves that object's paint out.

**Export.** `export3MFObjects` / `export3MFObjectsData` with `bambu: true` (the
default) write the layer colours into the project: one filament per colour and
a filament switch at each change, so the slicer opens it with the changes
already on its layer slider. The result carries `warnings` when something had
to be left out:

- an object with both paint and layer colours (paint left out);
- a plate shared by objects with different layer colours. The slicer applies
  layer changes to a whole plate, so they are left out for that plate. Keep a
  layer-coloured object on its own plate (the default `plateLayout: 'separate'`);
- a generic export (`bambu: false`), which can't carry them.

SCAD, BREP and voxel sessions can't declare layer colours yet.

## Print preview

`setPrintPreview({enabled?, layer?, z?, blend?})` shows the open object as the
bands that will print instead of its own colours, and returns `{enabled,
showing, layer, totalLayers, z, blend, notes?}`.

- `layer` (how many layers are printed, 1-based) or `z` (mm above the bed)
  cuts the model there, like scrubbing a slicer's layer slider; the opening is
  capped in that layer's colour. `null` shows the whole model. Pass one, not
  both.
- `blend: true` adds a rough estimate of how thin translucent top layers mix
  with the colour underneath. It is a guide, not a colour-accurate simulation:
  real results depend on the filament.
- While the preview is on, the viewport **and** `renderView` / `renderViews`
  show it. So to check a layer-colour design: `setPrintPreview({enabled:
  true})`, render, then `setPrintPreview({enabled: false})`.
- `showing` is false when the object declares no layer colours; `notes` says
  why. The preview is per tab and is not saved.
- It does not show toolpaths, infill, seams, supports or the purge tower, and
  it won't show thin features a slicer drops.

Users open the same thing from Inspect -> Print preview (`tool-print-preview`).

## Printing a figure in pieces

To cut a model into separate pieces for printing (head, arms, legs, eye
inserts), detect and accept its parts, then cut along them with
`splitIntoPieces`. It supports flat, medial (follows a fused contact) and
plug (insert + socket, with `clearance`) seams, plus a pulled-apart preview.
Don't cut with hand-placed planes across fused parts. See
[/ai/segmentation.md#split-into-printable-pieces](/ai/segmentation.md#split-into-printable-pieces).

## Automatic warning on export

The same `checkPrintability` runs automatically every time the user exports to
**STL / OBJ / 3MF / GLB**. If there are blockers or warnings, a toast surfaces
a one-line summary alongside the export — the export still proceeds; the warn
is just a heads-up. The full report stays available via `checkPrintability()`
or the 🖨 Print panel under **Inspect**.
