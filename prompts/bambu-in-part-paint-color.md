---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

The Bambu export doesn't seem to export any paintbrush colouring I do. I don't see
any new colours in the imported view, and I don't see any of my hand-painted brush
marks on the objects.

## Assistant

Traced the paint→export path: the bake (bakeColoredMeshForPart) DOES capture
hand-paint — `versionColorRegions` (manual paint layer) and the active part's
coloredMeshForExport both compose into the mesh's triColors. The Bambu path was
then discarding it: it emitted PLAIN triangles and collapsed each part to one
dominant `extruder` colour. So small brush marks never changed the dominant ("no
new colours") and the per-triangle detail was dropped ("no marks"). That was the
deferred in-part paint_color path.

Wired per-triangle paint_color into Bambu mode. Built a frequency-based ≤3-slot AMS
palette across ALL parts' colours (the H2C config defines exactly 3 filaments and
we never resize that array — it's what crashed load_files when short). Each object's
base extruder = its dominant slot; every triangle whose slot differs carries a
paint_color (Bambu's MMU segmentation attribute, via the existing unit-tested
encodePaintColorState). Colours beyond 3 snap to the nearest slot (documented cap,
tracked in #729). Reused the encoder the generic path already had; no new format.

Validated in the Bambu CLI: a part with two colour regions emits paint_color="4"
(= filament 1, confirmed against encodePaintColorState) on the off-base triangles,
filament_colour carries the palette, and the file slices clean (rc 0, 3 plates) —
so the paint_color attribute is accepted, not just well-formed. e2e flipped from
asserting NO paint_color to expecting it on the two-colour Body part (and still no
m:colorgroup in Bambu mode). Final colour-display confirmation is the user's GUI
check.
