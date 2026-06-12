---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei-release-docs
files_changed:
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
  - public/ai/printing.md
  - public/ai/textures.md
  - src/ai/systemPrompt.ts
  - tests/unit/sdfFigure.test.ts
  - examples/figure_karate.js
  - examples/figure_strongman.js
  - src/storage/sessionManager.ts
---

## Human

Pre-production-release review of `main`. The user-facing changelog and help page
had fallen behind the last ~5 days of merged features, and the review found a
false-green test plus assorted doc/comment drift. Fix the release-facing docs
and test integrity on `main` first (the CLAUDE.md promotion rule forbids putting
release notes on the release branch).

## Assistant

Release-readiness docs + test integrity:

- **Changelog (`whatsNew.ts`)** — added a June 8–12 week covering the figure
  builder, Tinkercad-style Arrange mode, surface-texture scoping, engrave/emboss,
  the machinist-diamond knurl profile, and non-destructive parametric scale.
- **Help page (`help.ts`)** — the Surface bullet listed only fuzzy/smooth/voxelize/
  fabric; extended it to cover knurl (round/pyramid), voronoi, voronoi lamp, and
  engrave/emboss, plus scoping; added an Insert & Arrange bullet.
- **AI subdocs** — documented `mirrorModel` and `previewScale` in `printing.md`
  (both were in `help()` pointing there but undocumented) and `buildEngraveStamp`
  in `textures.md`. Added `figure` to both `readDoc` available-name lists in
  `systemPrompt.ts` (the preamble already directs models to `readDoc("figure")`,
  but the lists only mentioned `sdf`).
- **Test integrity** — `sdfFigure.test.ts`'s "zero spine is byte-identical" test
  iterated over `headCenter`/`shoulderL`, both renamed away by the figure VRM
  refactor, so `expect(undefined).toEqual(undefined)` passed vacuously. Switched
  to the real joint names (`head`/`upperArmL`) so it actually guards them.
- **Comment drift** — figure example comments still named `shoulderL`/`headCenter`
  (the code uses the new names); fixed. `sessionManager.ts` comment said "schema
  1.11+" for thumbnail-camera restore; it's 1.12+.

Verified: typecheck, full unit suite (1264, incl. the de-vacuumed test), and a
production build all pass; screenshotted /whats-new to confirm the changelog
renders.
