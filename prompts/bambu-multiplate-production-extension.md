---
date: 2026-06-17
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

I still only get 1 plate from the Bambu export. Can we run the BambuStudio source
/ a headless test to validate files? (Then, after that worked:) the multi-plate
finally works — keep going.

## Assistant

Stood up a real headless validation loop: OrcaSlicer 2.3.2 AppImage (shares Bambu's
`bbs_3mf` loader) run via `xvfb-run … --appimage-extract-and-run --slice 0`; a 3mf
that fails to load exits 127 with no `result.json`, a good one writes `result.json`
with `sliced_plates[]`. This turned blind guessing into tested iteration (harness +
recipe in /tmp/slicer-spike).

Root cause of "1 plate": Bambu/Orca's project loader only builds the plate list
when the 3mf uses the **3MF production extension** — objects stored as
`<components><component p:path="/3D/Objects/object_N.model"/>` referencing separate
mesh files, NOT inline meshes (inline → "0 objects" → load abort). It also needs a
minimal `project_settings.config` (≥1 recognized key) or it falls back to a single
plate.

Rewrote the Bambu path of `build3MFProject` to that layout: wrapper objects + per-
part `/3D/Objects/object_N.model` files + `3D/_rels/3dmodel.model.rels` +
`requiredextensions="p"`; one `<plate>` per part; a 6-key `project_settings.config`;
`[Content_Types].xml` WITHOUT a `config` Default; empty dir entries; `fmtCoord`
(trailing-zero-stripped); 2-col plate grid (stride 240, offset 90) so plates aren't
empty; `tz=-zMin` to rest on the bed. Kept my generic-grid mode, signature, shared
filament list, and paint_color/extruder colour fidelity (the parallel implementer
worktree had branched from STALE main and dropped those, so I ported its validated
buildBambu structure into my file by hand rather than merging it).

The last bug took bisecting the generated file against a known-good one through the
Orca harness, one package file at a time: **a non-empty `plater_name` in
model_settings.config makes the loader reject the project** (127). Emitting
`plater_name=""` fixed it. Final real colored 3-part export now loads in OrcaSlicer:
exit 0, 3 plates, return_code 0, 3 gcode files.

e2e updated to assert the production-extension invariants (component/p:path count,
project_settings present, EMPTY plater_name as a regression guard, distinct per-
plate item X, colours). 1398 unit tests pass (only the unrelated catalog
date-rollover test #723 fails); no dep cycles. Bambu-side proven against OrcaSlicer;
final confirmation on the user's actual Bambu Studio still warranted.
