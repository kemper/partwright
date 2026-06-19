---
date: 2026-06-15
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - src/main.ts
  - src/ui/toolbar.ts
  - tests/threemf-multipart.spec.ts
---

## Human

(After testing PR #681 on a real Bambu printer.) It imported into Bambu and the
colours came in without the standard-3MF import menu — but Bambu warned "The 3mf
file has following customized filament or printer presets: … confirm the G-codes
within these presets are safe", and all parts appeared sitting on the first plate
(though 3 plates existed). I want to keep the old 3MF export exactly as it was and
build this as a separate export option — maybe "3MF Bambu/Orcaslicer only" to
signal it's not a generic 3MF. Create the alternate option, preserve the original
3MF export, and fix those two issues.

## Assistant

Three changes.

**Product split.** Reverted `actionExport3MF` to the original generic single-part
export and added a separate `actionExport3MFBambu` (toolbar item "3MF —
Bambu/Orca" + command `export-3mf-bambu` + `onExport3MFBambu` callback) that opens
the part picker and always emits the Bambu project layer. `export3MFMultiPartFlow`
/ `export3MFParts` now always use `build3MFProject` (the generic single-object path
lives only on the original 3MF export).

**Bug 1 — all parts on plate 1.** Read OrcaSlicer `PartPlate.cpp`: Bambu assigns an
object to a plate by **world position** (`reload_all_objects` → `intersect_instance`
box overlap), NOT by the `model_settings.config` `<model_instance>` grouping (that
map is parsed but discarded for placement — the seeding line is commented out).
Plates tile in one world space, single row, stride = bed × 1.2 (fixed
`LOGICAL_PART_PLATE_GAP = 1/5`). I had centred every part at (128,128), so every
bbox overlapped only plate 0's box. Fix: offset each part's `<item>` transform to
its own plate centre — `TX = platePos + i·(platePos·2·1.2)`, `TY = platePos`
(`platePos` = bed half-extent, so bed = 2·platePos). Kept the `<plate>` blocks
(harmless; they name/lock the plates).

**Bug 2 — "customized presets / unsafe G-code" warning.** From
`PresetBundle::validate_presets` / `Preset::validate_preset`: the dialog fires when
`filament_settings_id` / `printer_settings_id` name a preset that doesn't resolve
to a system/bundled one. My `filament_settings_id: ["Generic PLA", …]` was the
trigger (no `inherits`, not a real system preset name). Empty/absent preset ids
skip validation. Fix: drop `filament_settings_id` and `filament_ids` from
`project_settings.config`, keeping only `filament_colour` (+ `filament_type`, which
is never validated) — colours still pre-bind to AMS swatches with no warning. (The
colours themselves arrive via per-object `extruder` + per-triangle `paint_color` +
`m:colorgroup`, independent of project_settings, which matches the user's report
that colours imported fine.)

Both Bambu specifics came from reading the OrcaSlicer source (shared lineage with
Bambu's importer); I can't run a real Bambu here, so the user re-validates on
hardware. Strengthened the builder e2e to assert the two `<item>` transforms have
distinct X (Bug 1 regression guard) and that no `*_settings_id` keys are emitted
(Bug 2 guard). 1399 unit tests + both multi-part e2e tests pass.
