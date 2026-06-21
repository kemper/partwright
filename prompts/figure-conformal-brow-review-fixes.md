---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - tests/unit/sdfFigure.test.ts
---

## Human

(work-reviewer findings on PR #741) Should-fix: (1) `assembleFace` now always
passes `on: result`, silently switching ~50 in-assemble-brow figures from the
legacy flush strip to a proud conformal brow — no escape hatch, no test guard;
(2) the new brow `on` param is undocumented (API/doc parity); nit: a duplicated
"Self-labelled" comment.

## Assistant

Addressed all three. The blast-radius finding was sharper than first read:
in-assemble brows are flattened to skin by the `.label('skin')` weld, so they are
deliberately FLUSH ("not a raised ridge") — forcing the proud conformal path
would add an unwanted brow ridge to ~50 figures (a regression). So I scoped the
conformal brow to OPT-IN: reverted `assembleFace` to the legacy in-assemble path
(now byte-identical to main — zero blast radius), leaving the proud conformal
brow for the top-level painted path via `F.face.brows(rig, { on: skin })` (what
`expectant_mother` uses). Documented the `on` param in `public/ai/figure.md`'s
Brows section (mirroring `F.nipples({ on })`). Added a unit test exercising the
`on` path (label survives the offset+clip; non-degenerate geometry seated at the
brow height) — the previously-unguarded branch. Removed the duplicated comment.
typecheck clean; 242 figure unit tests pass; expectant_mother builds comp=1 with
brows resolving.
