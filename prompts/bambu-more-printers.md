---
date: 2026-06-19
branch: claude/bambu-more-printers
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
  - public/ai/file-io.md
---

## Human

I do want "More printer models" — you should be able to gather the exact strings
from the bambu studio source code right?

## Assistant

Yes — resolved every Bambu machine profile (resources/profiles/BBL/machine, following
`inherits`) for exact printer_model + bed + nozzle count, and every "0.20mm Standard"
process preset's compatible_printers to map each printer to its process.

This caught a bug in what shipped (#759): H2S is SINGLE-nozzle but I'd put it on the
dual H2C base — Bambu would have converted it. Fixed (H2S/A2L → single P1S base; only
H2C/H2D/H2D Pro/X2D are dual). Added H2D Pro, X2D, A2L, X1 Carbon ("Bambu Lab X1
Carbon"), X1E, P2S — 14 printers total.

Bigger latent bug surfaced via CLI: any printer whose model ≠ its base printer hit
rc -17 "printer not compatible with the process preset" — because the base config's
`print_settings_id` + `print_compatible_printers` still named the base printer. Only
P1S (and X1/X1C/X1E, which share the P1S base's print_compatible_printers list) and
H2C worked. Fix: per-printer `process` (the right "0.20mm Standard @BBL <suffix>";
P1S/X1* share "@BBL X1C"), and override both `print_settings_id` and
`print_compatible_printers` to the target printer in buildProjectSettings.

Validated in the Bambu CLI: H2S, X2D, H2D, A1 mini, P1S all slice rc 0 (single +
dual, base + non-base). e2e guards H2S=single-nozzle and the non-base process/compat
stamping (H2S/H2D). The remaining models follow the identical override path; the user
can GUI-confirm by loading the export.
