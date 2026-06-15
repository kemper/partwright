---
date: 2026-06-15
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - src/ui/exportPartsModal.ts
  - src/main.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - public/ai/file-io.md
  - tests/threemf-multipart.spec.ts
---

## Human

(After more real-Bambu testing of #681.) Could the generic 3MF export also do
multiple parts, without any Bambu-specific features like plates — parts spread
out in a grid? And: the Bambu export now spaces the 3 objects horizontally and
associates them to 3 plates, but only the first is centred on its plate, and I
still get the "customized filament or printer presets / confirm the G-code is
safe" warning. So: make generic 3MF export multiple parts, then improve the
Bambu export.

## Assistant

Turned the multi-part builder into one function with a `bambu` flag.

**Generic multi-part (new).** `build3MFProject(parts, { bambu: false })` emits a
plain multi-object 3MF — `m:colorgroup` colours, no Bambu metadata, no
`paint_color` — with parts laid out in a centred square grid (pitch = largest
footprint + gap) so they never overlap. The generic "3MF" menu item now opens the
part picker for multi-part sessions (single-part unchanged); the picker's
title/help text adapts to the mode.

**Bambu fix 1 — only the first part centred on its plate.** My plate stride
assumed a 256 mm bed; on a different bed the parts drift progressively. Now the
stride comes from the user's configured bed size (`loadPrinterSettings().bed`),
threaded through as `bedSize`: `plateCenterX = i·(bedX·1.2) + bedX/2`. So I
removed the `export.platePositionMm` config/advanced-settings field I'd added last
round (redundant — bed size drives it).

**Bambu fix 2 — preset/G-code-safety warning persisted** even after dropping
`filament_settings_id`. The dialog is gated on `project_settings.config` existing
at all (PresetBundle::validate_presets runs only when it's present), so I now
**omit `project_settings.config` entirely**. Colours still import + map because
they ride on `m:colorgroup` + per-object `extruder` + `paint_color` in the model
itself (which is why the user's first test showed colours even with the warning).

API: `export3MFParts` gains an `{ bambu }` option (default true); help() + docs
updated. e2e now builds BOTH modes and asserts: Bambu has the marker,
model_settings.config, paint_color, NO project_settings.config / preset ids, and
the two `<item>` X offsets differ by the bed×1.2 stride; generic has the
colorgroup but NO BambuStudio marker / model_settings / paint_color and distinct
grid X positions. 1399 unit tests + both e2e specs pass; no dep cycles.

I can't run a real Bambu here, so the bed-stride centring + warning removal need
the user's hardware re-test.
