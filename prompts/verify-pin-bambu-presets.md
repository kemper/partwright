---
date: 2026-06-21
branch: claude/codebase-audit-post-release-lr28ye
files_changed:
  - src/export/threemfProject.ts
  - tests/unit/bambuPrinters.test.ts
---

## Human

After the audit flagged the 14 Bambu printers as having "unverifiable" process
presets and I (Claude) removed five, the user corrected: "I looked up those 5 and
they all exist." Asked how to handle the now-pointless removal PR, the user chose
"Repurpose to fix presets."

## Assistant

The five flagged printers (X2D, H2S, A2L, H2D Pro, P2S) are real shipping
machines — the "unverifiable" was my sandbox limitation (no access to the BBL
profile bundle), not evidence they were wrong. So I first restored all 14
printers on the branch (revert of the removal), then verified the strings
properly instead of guessing.

Delegated a web-research subagent to check every printer's exact `printer_model`
and `0.20mm Standard @BBL *` process-preset name against BambuStudio's live
`master` bundle (`resources/profiles/BBL`). Result: **all 14 model + process
strings were already exactly correct** — including the five uncertain ones. The
H2D Pro detail that's easy to get wrong checked out: model `Bambu Lab H2D Pro`
(spaced, "Pro" capitalised) but process abbreviation `@BBL H2DP`.

Since nothing needed correcting, the valuable deliverable is to *lock the
verification* so this can't silently drift or get re-flagged:
- Recorded the verification (date + provenance) in the `BAMBU_PRINTERS` comment.
- Added `tests/unit/bambuPrinters.test.ts` pinning every printer's exact `model`
  + `process` string against a verified snapshot, plus an id-set check so a
  silent add/remove fails. A wrong string is what causes Bambu's rc -17
  ("printer not compatible with the process preset") reject, so the pin guards
  the exact failure mode the audit worried about. The module imports cleanly in
  the node unit tier, so this lives in the fast tier (not e2e).

This closes the #825 "verify the Bambu process-preset strings" item — verified
correct + pinned, rather than removed.
