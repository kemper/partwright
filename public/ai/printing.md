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
- **Bed fit** — bounding box vs the build volume (fail = too big → use the
  Resize tool to shrink, or the Split tool to cut into bed-sized pieces).
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

Then fix problems at the source: thicken walls, re-orient, edit the dimension
constants in the model code (preferred for parametric models), or steer the
user toward the Resize / Split tools when bed fit is the blocker.

## Automatic warning on export

The same `checkPrintability` runs automatically every time the user exports to
**STL / OBJ / 3MF / GLB**. If there are blockers or warnings, a toast surfaces
a one-line summary alongside the export — the export still proceeds; the warn
is just a heads-up. The full report stays available via `checkPrintability()`
or the 🖨 Print panel under **Inspect**.
