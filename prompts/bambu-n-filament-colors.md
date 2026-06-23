---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

The Bambu export only shows 3 colours (not always the same 3) and coerces all other
colours to match those 3. My models use ~11 colours. (Chose: attempt the
multi-filament fix now, accepting crash risk over another reference round-trip.)

## Assistant

The "not always the same 3" was the key tell: Bambu IS honoring the project's
filament_colour (the 3 vary per model) — so there's no GUI override, just the hard
3-filament cap plus nearest-snap. Fix: emit one filament per distinct colour (up to
16) and resize the H2C config's per-filament arrays to match.

Did NOT guess the resize blindly. Pulled BambuStudio source (Preset.cpp
s_Preset_filament_options) for the authoritative per-filament key list and PartPlate
for the grid. Findings that shaped it: per-filament arrays have a multiplier m =
len/3 (×1 per filament, ×2 per extruder-variant, ×4 for the AMS-drying arrays);
filament_self_index is the [1,1,2,2,…] index pattern; flush_volumes_matrix is
2×N×N; and non-per-filament length-3 arrays exist that must NOT scale
(upward_compatible_machine = 3 compatible printers). Gate: resize a key iff it's
`filament_`-prefixed OR in the non-prefixed per-filament set (from source), and its
length is a clean multiple of 3 — repeating filament-0's m-tuple N times (all
template filaments share one preset, so the tuples are identical). filament_colour /
filament_self_index / the flush matrices are set explicitly. Plate filament_maps is
resized to length N too.

Validated in the Bambu CLI: a 12-colour export LOADS (no crash, no -50, no -66) and
reaches G-code with every per-filament array correctly sized (verified
filament_dev_ams_drying = 4N, nozzle_temperature = 2N, flush matrix = 2N²,
upward_compatible_machine left at 3). A normal 5-colour/5-plate export slices clean
(rc 0). The only failure is `-104` wipe-tower-overflow when a SINGLE part carries
many colours (e.g. the 11-colour tree on one plate needs an oversized purge tower) —
a multi-colour printing constraint, not a load/colour bug; colours still display on
open. Filed as a follow-up.

The GUI load path still can't be exercised headlessly, but the resize keeps every
per-filament array consistently ≥ N (the crash class was SHORT arrays), so the
null-deref shouldn't recur. e2e asserts filament_colour scales to the distinct-colour
count, nozzle_temperature to 2N, and upward_compatible_machine stays 3.
