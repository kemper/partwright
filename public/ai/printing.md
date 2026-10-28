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

## Automatic warning on export

The same `checkPrintability` runs automatically every time the user exports to
**STL / OBJ / 3MF / GLB**. If there are blockers or warnings, a toast surfaces
a one-line summary alongside the export — the export still proceeds; the warn
is just a heads-up. The full report stays available via `checkPrintability()`
or the 🖨 Print panel under **Inspect**.
