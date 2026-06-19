---
date: 2026-06-18
branch: claude/bambu-printer-picker
files_changed:
  - src/export/bambuProfiles.ts
  - src/export/bambuProfiles/**.json
  - tests/unit/bambuProfiles.test.ts
  - retros/inbox/2026-06-18-bambu-3mf-export.md
---

## Human

(After merging #681, the multi-plate + N-color Bambu export.) Create a new PR for
the follow-up work — let people select their printer model on Bambu export so it's
not hardcoded to H2C, and expose filament type + layer profile + plate thumbnails
(tracking #757). Feel free to have subagents investigate the real BambuStudio
codebase to create a file-content listing.

## Assistant

Started the follow-up on a fresh branch off the now-merged main. This first commit
is the foundation: BambuStudio's official presets carry an `inherits` chain
(machine "Bambu Lab H2C 0.4 nozzle" → fdm_bbl_3dp_002_common → fdm_machine_common;
process and filament similarly), so a printer's full config is the leaf preset
merged onto its base chain. `bambuProfiles.ts` resolves those chains into one flat
preset (base→leaf, leaf wins, chain-control keys stripped); `listPresets` surfaces
the user-selectable leaves. Vendored the complete H2C chain (machine ×3, process ×4,
filament ×4) as the regression anchor — it must reproduce the config that the shipped
hardcoded template carries.

Kept this layer pure + dependency-free (Vite `import.meta.glob` to bundle the JSONs;
no runtime fetch) so it unit-tests headlessly — 4 tests cover chain resolution,
leaf-override, unknown-preset throw, and leaf listing. Deliberately small/reviewable:
the composer (resolved machine+process+filament → project_settings.config, diffed
against the real H2C template to capture any runtime-only keys), the printer/filament/
layer picker UI, more printer chains, and plate thumbnails land in follow-up commits
on this PR (full plan in #757).

Also banked the prior session's retro and a BambuStudio 3MF file-content listing (the
subagent's research) into #757 — confirmed Partwright omits nothing load-critical.

Licensing note for review: the vendored profile JSONs are BambuStudio's system
presets (AGPL-3.0); flagged in the PR.
