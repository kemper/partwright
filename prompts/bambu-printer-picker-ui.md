---
date: 2026-06-19
branch: claude/bambu-printer-picker
files_changed:
  - src/ui/exportPartsModal.ts
  - src/export/threemfProject.ts
  - src/main.ts
  - tests/threemf-multipart.spec.ts
  - public/ai.md
  - public/ai/file-io.md
---

## Human

I just exported and didn't see any way to pick a printer — I need a UI to actually
test this. Do all the remaining tasks and add them to the PR.

## Assistant

The data layer (printer/nozzle override) had landed but there was no UI, so the
modal looked unchanged. Built the user-facing dropdowns + finished the exposable
options:

- `exportPartsModal`: added an optional "Bambu Studio settings" section (Printer /
  Nozzle / Filament `<select>`s) shown only for the Bambu/Orca export. Changed its
  result from `string[]` to `{ partIds, printer?, nozzle?, filament? }`; updated both
  callers (the 3MF flow passes the picks to build3MFProject; the OBJ/STL/GLB flow
  just reads partIds).
- Filament type: added BAMBU_FILAMENT_TYPES (PLA/PETG/ABS/ASA/TPU/PC) — one material
  for all colours, stamping filament_type + "Generic <TYPE>" settings_id + nozzle/bed
  temps over the already-resized per-filament arrays.
- API parity (UI↔JS): export3MFParts/export3MFPartsData + build3MFPartsExport now
  take {printer, nozzle, filament}; updated help() signatures + ai.md + ai/file-io.md.

Validated end-to-end: H2C default unchanged; a **P1S** 4-colour export and a **PETG**
3-colour export each load + slice in the Bambu CLI (rc 0); the PETG file carries
filament_type=PETG / settings_id="Generic PETG" / nozzle 255. Screenshotted the modal
(Printer/Nozzle/Filament dropdowns) for the user. e2e asserts the dropdowns render
(3 selects + "Bambu Studio settings") and drive a P1S export through the modal.

Plate thumbnails (the last #757 item) deliberately deferred: per the BambuStudio
source audit they're cosmetic — Bambu regenerates them on slice — so low value vs the
headless-render cost. Noted in the PR/issue rather than built.
