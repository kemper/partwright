---
date: 2026-06-18
author: claude (opus-4-8)
task: Bambu/Orca multi-plate + multi-color 3MF export (PR #681)
---

## Liked
- Crash report as ground truth: a macOS `.ips` with register state (the bytes "filament" in x10) pinned a SIGSEGV to `Plater::load_files` filament binding in one read, after days of blind guessing. Always ask for the crash log.
- The Bambu CLI (`xvfb-run … --slice 0` / `--export-3mf` / `--arrange`) as a deterministic oracle for LOAD + placement + round-trip, and `--appimage-extract` to read the bundled official profiles. Reverse-engineering from BambuStudio source (PartPlate.cpp grid stride, Preset.cpp `s_Preset_filament_options`) beat every empirical guess.

## Lacked
- A way to validate the Bambu **GUI** load path headlessly — the crash class (short per-filament array → null deref) is invisible to the CLI (`--slice` uses a different loader than `load_project`), so every GUI-crash fix needed a user round-trip. This cost the most cycles.
- Knowing early that the user could LOAD any printer profile in the GUI without owning it — I spent a whole exchange treating non-H2C as unvalidatable. Ask "can you open it / what does the GUI show" before theorizing.

## Learned
- Bambu honors project `filament_colour` (CLI round-trip preserved it); "wrong colors" was the 3-filament **cap** + nearest-snap, not a GUI override — the tell was "the 3 vary per model." Distinguish cap vs override by whether output tracks input.
- Bambu plate grid = `⌈√N⌉` cols, per-axis stride `width·1.2`/`depth·1.2`; assignment is by world position, not the model_instance binding. Per-filament config arrays scale by `m = len/3` (×1, ×2 per extruder-variant, ×4 for AMS-drying); non-per-filament length-3 arrays (`upward_compatible_machine`) must NOT scale.
- OrcaSlicer is NOT a valid proxy for Bambu (the real reference fails in Orca, opens in Bambu). Optimizing for the wrong validator cost a whole rewrite.

## Longed for
- A headless Bambu **GUI**-load smoke check (even a scripted open-and-screenshot) would have collapsed ~6 user round-trips into self-serve iteration. Biggest single lever for this kind of work.
- A standing "real reference file" intake step for any external-format export: mirroring a known-good file cracked both the crash and the structure faster than spec-reading.
