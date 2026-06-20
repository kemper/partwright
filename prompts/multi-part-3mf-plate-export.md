---
date: 2026-06-14
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/paintColor3mf.ts
  - src/export/threemfProject.ts
  - src/ui/exportPartsModal.ts
  - src/color/regions.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/main.ts
  - public/ai/file-io.md
  - tests/unit/paintColor3mf.test.ts
  - tests/threemf-multipart.spec.ts
---

## Human

When exporting a session that has multiple parts, the default today is to export
just the currently-selected part. I want to instead pick which parts to include
(checkboxes), see a preview of each so I know what I'm selecting, preselect the
part currently being viewed, and have a Select-all button — then export the
chosen parts together as one 3MF. In a 3MF you can have multiple plates, so I
want one part per plate. I also want Bambu colour-matching on import. If
part-per-plate is proprietary, let's discuss. Other formats can be a follow-up.

## Assistant

Decisions taken with the user up front (research-backed): "parts" here are
**Session Parts** (the Parts Rail), not mesh components. Plates are NOT in the
generic 3MF spec — they're a Bambu Studio / OrcaSlicer extension. The user chose
"Generic + Bambu layer": emit a file that is BOTH a valid generic multi-object
3MF (every slicer sees all parts + colours) AND a Bambu project (one part per
plate, colours pre-bound to filaments). Colour fidelity: "full" (per-object
`extruder` + per-triangle `paint_color`), with the caveat that the proprietary
`paint_color` bitstream can't be tested against a real Bambu in this env.

Key format facts that shaped the implementation (from reading OrcaSlicer/Bambu
`bbs_3mf.cpp` + the 3MF specs): the load-bearing marker is
`<metadata name="Application">BambuStudio-…</metadata>` (the `BambuStudio-`
prefix flips Bambu into project mode); plates live ONLY in
`Metadata/model_settings.config` `<plate>` blocks mapping `object_id`→`plater_id`
(the per-plate `.json`/`.png`/`.gcode` are post-slice artifacts and optional);
once in project mode Bambu reads `extruder`/`paint_color` and may ignore the
generic `m:colorgroup`, so both colour encodings are written (generic for other
slicers, Bambu-native for Bambu). `paint_color` is a prefix-coded bitstream —
Partwright bakes one colour per triangle so only the leaf forms are needed;
`paintColor3mf.ts` implements + round-trip unit-tests them (validated against the
documented worked values `"4"`→filament 1, `"0C"`→filament 3).

Architecture: `build3MFProject(parts, opts)` (pure builder) emits the multi-object
model + model_settings.config (objects + per-part plates) + project_settings.config
(`filament_colour`). Each part is centred on its plate at the configurable
`export.platePositionMm`. `showExportPartsModal` is the picker (checkbox +
thumbnail from the part's latest `Version.thumbnail`, active part preselected +
badged, Select-all). `actionExport3MF` branches to the multi-part flow only when
the session has >1 part (single-part export unchanged). Non-active parts are
re-run off-editor and coloured via a new `bakeColoredMeshForPart`, which reuses
`resolveDescriptorTriangles` + a newly-extracted pure `composeTriColors`
(refactored out of `buildTriColors`) so BOTH colour layers — code `api.label`/
`api.paint.*` and saved manual paint — are resolved without disturbing live
editor state. API parity: `partwright.export3MFParts(partIds?, filename?)` +
help() entry + ai/file-io.md docs.

Verified: paint_color round-trips for all states; an e2e test calls the builder
in-page and asserts the unzipped 3MF has 2 objects, 2 `<plate>` blocks, the
BambuStudio marker, `m:colorgroup`, `paint_color`, `extruder`, and
`filament_colour`; a second e2e drives the picker UI end-to-end to a download.
All 1399 unit tests pass; no new dependency cycles.

Note: the `apiParity` unit test slices only the first 80 KB of the
`partwrightAPI` object, so it silently validates only ~1/3 of the API (and 67
methods are already undocumented behind that window). I kept the new API method a
thin wrapper so the object literal stays under that boundary rather than
expanding the test's scope in this PR; the window bug + undocumented backlog are
filed as a follow-up issue. Multi-colour `paint_color` needs real-Bambu
validation by the user, and the non-3MF formats are a deliberate follow-up.
