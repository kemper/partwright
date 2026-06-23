---
date: 2026-06-15
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
  - tests/unit/apiParity.test.ts
---

## Human

(Hardware test of the Bambu export.) Only one build plate appears and 2 of the 3
parts are to the left/right of it. (Earlier: the warning is gone after dropping
project_settings.config.)

## Assistant

Root-caused against the real bambulab/BambuStudio source (subagent, commit
60166b4). The importer always returns N PlateData from the `<plate>` blocks, but
`Plater.cpp` only *materialises* them (`load_from_3mf_structure` → N plates) when
`load_config == true`; it forces `load_config = false` whenever the project
config loads ZERO recognized DynamicPrintConfig keys (`config_loaded.empty()`),
routing to `reload_all_objects()` = a single default plate. Dropping
project_settings.config (my warning fix) is exactly what made it empty → 1 plate.
Object→plate assignment is purely by world-space bbox intersection, so my
bed-stride X tiling was already correct.

Fix: emit a MINIMAL `project_settings.config` = `{ "filament_diameter": ["1.75",
…] }` (one per filament). It's a recognized key (so config isn't empty →
load_config true → N plates), it avoids a null-deref in
`PresetBundle::validate_presets` (which dereferences `filament_diameter` without a
default), and it carries NO `*_settings_id`/`inherits_group`, so validate_presets
returns SUCCESS → no "customized presets" warning. Colours still come from the
model's m:colorgroup + extruder + paint_color. (Logic-verified in source, not
compiled — user re-tests on hardware.)

Also fixed the `apiParity` unit test, which CI tripped on this round: its 80 KB
scan window only ever covered the first ~⅓ of `partwrightAPI`, and the new
export methods pushed `setThumbnailCamera`'s declaration past 80 KB → "stale
undocumented entry". Widened the scan to the whole object (stops at `help(`
anyway) and split the ~65 pre-existing undocumented methods it surfaced into an
explicit `UNDOCUMENTED_BACKLOG` set referencing #683 (the gate still fails a NEW
undocumented method; the backlog is the triage list, asserted non-stale). This
permanently stops the window from biting future additions.

Verified: 3 multi-part e2e tests pass (builder both modes incl. project_settings
+ no preset ids; picker UI; and a NEW full-bake-pipeline test that builds 3 real
api.label-coloured parts and reads the Bambu 3MF back via export3MFPartsData,
asserting 3 objects/3 plates/filament_diameter/no settings-ids/≥3 distinct
colours). Unit tier: only the unrelated, pre-existing catalog freshness test
fails (a model's release_date aged out of the rolling-365-day window now that the
clock passed 2026-06-10 — fails on main too; filed separately).
