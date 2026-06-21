---
date: 2026-06-15
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

Whatever you did makes Bambu Studio crash when it attempts to open that file.

## Assistant

Reverted the `project_settings.config` I added last commit. The minimal
`{ filament_diameter: [...] }` was meant to flip Bambu's `load_config` true so it
builds the plate list — but doing so pushes Bambu into its FULL project-load path,
which then crashes on the rest of the config bundle it expects (Preset::normalize
/ prime-tower fix-ups touch keys a minimal config doesn't have). A complete bundle
would reintroduce the preset warning and is too version-fragile to synthesize
blind. So the Bambu export goes back to the safe non-crashing structure (marker +
model_settings.config, no project_settings.config), which opens fine but shows a
single plate.

This is the fourth distinct Bambu failure synthesizing the proprietary multi-plate
project format without hardware to test against (warning → off-centre → 1-plate →
crash). Pausing blind iteration; taking the direction back to the user. The
generic multi-object grid export (confirmed working) is unaffected.
