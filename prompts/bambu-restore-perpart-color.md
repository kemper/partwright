---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

Good news — Bambu now loads the multi-part file with each part on its own plate.
But now the colour is lost / the import has no colour, whereas before the crash
fixes colours imported cleanly but everything was on one plate. Any ideas?

## Assistant

The lost colour was the deliberate tradeoff from the crash fix: to stop the GUI
null-deref I shipped the complete H2C config but neutralized filament_colour to
grey and put every object on extruder 1. So colour needed restoring on top of the
now-stable multi-plate base.

The constraint that shaped the fix: the config has 95 length-3 arrays and 44
length-6 arrays. Most are per-filament (×1) / per-filament-×2-nozzle, but several
length-3/6 arrays are NOT filament-indexed, and the length-4/8/12/18 arrays
(flush matrices etc.) have non-obvious structure. Resizing the config to N
filaments can't be validated against Bambu's GUI loader headlessly, and a
too-short per-filament array is exactly what crashed it. So I kept the filament
count FIXED at 3 (the template's native count, zero array resizing) and restored
colour by changing only VALUES: write the part palette into filament_colour and
assign each object a per-object `extruder` (1..3) — the exact field the reference
uses to drive object colour, just with non-1 values.

Implementation: in build3MFProject, collect each part's dominant colour, dedupe
into a ≤3-slot palette, reassign each part's extruder to its palette slot, pad the
palette to length 3, and stamp it into project_settings' filament_colour (length
unchanged — never resized). Mesh files stay PLAIN triangles (whole-object colour;
in-part multicolour would need the unvalidated paint_color path).

Validated: red/green/blue 3-part export → filament_colour
["#FF0000","#00FF00","#0000FF"], objects on extruders 1/2/3, and the Bambu CLI
slices it: return_code 0, 3 plates, one part each, no placement errors. e2e
strengthened to assert distinct per-object extruders + the palette in
filament_colour (regression guard against the grey single-colour base).

Limitation: capped at 3 distinct part colours (the common AMS case); >3 reuses the
closest slot. Lifting the cap needs a validated config resize (still #729). Final
in-Bambu colour-display confirmation is the user's GUI check.
