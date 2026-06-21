---
date: 2026-06-21
branch: claude/codebase-audit-post-release-lr28ye
files_changed:
  - src/export/threemfProject.ts
  - public/ai/file-io.md
  - src/content/data/whatsNew.ts
  - tests/threemf-multipart.spec.ts
---

## Human

After the post-release audit flagged "unverifiable speculative Bambu printer
presets (rc -17 risk)" and explained it: "let's remove the unshipped printers".

## Assistant

Removed the five Bambu printers whose `model` + process-preset strings couldn't
be corroborated against shipped BambuStudio profiles — **X2D, H2S, A2L, H2D Pro
(`@BBL H2DP`), P2S (`@BBL P2S`)** — from `BAMBU_PRINTERS`. A wrong process string
makes Bambu reject the whole project with rc -17 ("printer not compatible with
the process preset"), and the boundary validation added in #824 only rejects
*unknown ids*, not a listed-but-wrong preset — so the only safe move for the
unverifiable five is to not offer them. Kept the nine corroborated printers
(H2C, H2D, X1C/X1E/X1, P1S, P1P, A1, A1 mini).

Knock-on updates:
- The export modal builds its dropdown from `BAMBU_PRINTERS.map(...)`, so it
  updates automatically — no UI change needed. `DEFAULT_BAMBU_PRINTER` ('h2c')
  still exists.
- `tests/threemf-multipart.spec.ts` used `h2s` as the single-nozzle + non-base
  process-stamping regression guard; H2S was one of the removed large-bed
  single-nozzle models, so I re-pointed the guard at `a1` (also single-nozzle,
  non-base, with its own `@BBL A1` process + compat) — it still validates both
  the P1S-base selection and the rc-17 process-stamping fix.
- `public/ai/file-io.md` printer-id list trimmed to the nine.
- The 1.1 changelog bullet said "any of 14 Bambu Lab printers"; reworded to "a
  range of Bambu Lab printers" so the count isn't brittle.

Re-add path documented in the source comment: restore a printer only with its
verified `model` + process string from the real BBL profile bundle.
