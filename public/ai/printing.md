# Design for 3D Printing

Tools and helpers for turning a model into something that actually prints well.
These read a shared **printer profile** (build volume + nozzle), so set that
first when the user names their machine.

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
- **Bed fit** — bounding box vs the build volume (fail = too big → scale or split).
- **Overhangs** — downward faces shallower than `overhangAngleDeg` (default 45°
  from horizontal) that will need support. Consider re-orienting to remove them.
- **Thin walls** — a *sampled* interior-ray estimate of the thinnest wall vs the
  nozzle (fail < 1 nozzle width, warn < 2). It's an estimate, not exact.
- **Small features** — smallest overall dimension near the nozzle limit.
- **Stability** — centre of mass vs the base footprint (warn = may tip over).
- **Watertight** — non-manifold / render-only geometry won't slice (fail).

```js
const r = partwright.checkPrintability();
// r.ok === false → read r.checks, fix the `fail` items, re-check.
```

Then fix problems at the source: thicken walls, re-orient, `scaleModel`, or
`splitForPrinting`.

## scaleModel(opts)

Geometric scale of the **rendered mesh**, saved as a new version. Provide exactly
one of:
- `{ factor }` — uniform multiplier.
- `{ scale: [sx,sy,sz] }` — per-axis.
- `{ to: { axis:'x'|'y'|'z'|'max'|'min', length } }` — make that axis an exact size.
- `{ fit: { margin?, mode?:'shrink'|'fit' } }` — largest uniform factor that fits
  the build volume (`shrink` only downscales; `fit` also upscales to fill).

> **Prefer parametric scaling for models you authored.** This bakes to a mesh and
> scales *every* feature — screw holes, clearances and walls included — so an M3
> hole becomes oversized. If the model came from your own code, edit the dimension
> constants instead (so functional features keep their real size). Reach for
> `scaleModel` for imported meshes, or quick "make it fit / make it half size".

```js
partwright.scaleModel({ to: { axis: 'max', length: 100 } }); // longest side = 100mm
partwright.scaleModel({ fit: {} });                          // shrink to fit the bed
```

## splitForPrinting(opts?)

When a model is bigger than the bed and the user wants it at **full size**, cut it
into bed-sized chunks with matching dowel-pin holes across each cut (print pins or
use a rod to register, then glue). Chunks are laid out in a row and saved as a new
version. Cuts X/Y by default (keeps flat bottoms); pass `axes:['x','y','z']` to
allow Z.

```js
partwright.splitForPrinting();                        // auto-cut to the bed
partwright.splitForPrinting({ connector: { type:'pin', diameter: 6 } });
```

Returns `{ partCount, grid, holeCount, notes, saved }`.

## Gridfinity generator — `api.Gridfinity`

Inside model code, build spec-compliant Gridfinity storage on the 42 mm grid:

```js
return api.Gridfinity.bin({ cols: 2, rows: 1, heightUnits: 6 }); // a 2×1×6U bin
return api.Gridfinity.baseplate({ cols: 4, rows: 3 });            // a 4×3 baseplate
```

- `bin({ cols=1, rows=1, heightUnits=3, hollow=true, wallThickness=1.2, lip=true, magnetHoles=false })`
- `baseplate({ cols=1, rows=1 })`

Total bin height is `7 × heightUnits` mm; feet seat into the baseplate sockets.
