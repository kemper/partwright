---
date: 2026-06-19
branch: claude/bambu-printer-picker
files_changed:
  - src/export/threemfProject.ts
  - src/export/bambuProjectTemplateP1S.json
  - tests/threemf-multipart.spec.ts
---

## Human

(After I started a vendored-profile composition engine for the printer picker.)
I'm confused — I was thinking we'd just give people a dropdown to pick printer +
nozzle + filament, not pull in actual files from bambu. … (Then, on the
single-nozzle base question:) I do actually have a P1S — here's the real profile I
selected. [uploaded a P1S project export]

## Assistant

Scrapped the over-engineered profile-composition engine (removed the vendored BBL
profile chain + resolver). Pivoted to the simple approach the user wanted: a small
in-code printer table + override, no Bambu profile files.

The user's P1S export was the key — it's both a real single-nozzle BASE and, with 17
filaments, an independent validation of the N-filament resize against a real Bambu
file (filament_type=17, nozzle_temperature=34, flush_matrix=289=17², dev_ams=68=4×17
— all matching my resize math). It revealed single-vs-dual differs in exactly two
places: nozzle_diameter/extruder_type length (1 vs 2) and flush_volumes_matrix
(nozzleCount × N×N). The per-filament ×1/×2/×4 multipliers are nozzle-independent.

So: two structural bases (H2C dual = bambuProjectTemplate.json, P1S single =
bambuProjectTemplateP1S.json), both real project exports. buildProjectSettings now
derives the base's own filament count (T) and nozzle count from the base itself
(instead of a hardcoded 3 / 2), resizes per the m=len/T rule, builds the flush matrix
at nozzleCount×N², then stamps printer identity/bed/nozzle. A BAMBU_PRINTERS table
(H2 family on the dual base; P1/X1/A1 on the single base — verified model strings +
public bed footprints) drives a `printer` + `nozzle` option on build3MFProject.

Validated: H2C default unchanged (e2e green); a P1S-targeted 4-colour export loads +
slices to 4 plates in the Bambu CLI (rc 0); structure correct (single nozzle, flush
16=4², 256×256 bed). e2e asserts the base swap + identity/bed/nozzle stamping.

Deliberately the data layer only — the export-modal dropdowns (printer/nozzle/
filament) + console-API passthrough + filament-type are the next commit on this PR.
Removed the now-dead bedSizeFromTemplate + TEMPLATE_FILAMENT_COUNT (placement now
uses the printer's bed). Note: vendored P1S config is the user's own project export
(like the H2C base), not a Bambu profile file.
