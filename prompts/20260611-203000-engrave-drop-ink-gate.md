---
session: "engrave-drop-ink-gate"
timestamp: "2026-06-11T20:30:00Z"
model: claude-opus-4-8
---

## Human

Still seeing missed rectangles in the emboss/engrave letters on a curved sphere
(tested word "BOLDE") — systematic notches on certain letter walls. Fix without
bleeding onto the original mesh. (Screenshots attached.)

## Assistant

### Diagnosis (measured, not guessed)

Built a headless reproduction in the unit tier — a pure-JS UV sphere + a
synthetic "H" mask run through the real `applyEngrave` (surface-nets carve, no
browser) — and instrumented it. Result: of the "clearly raised" relief
triangles that were left uncolored, **95% had displacement far above the
threshold** (median 1.4 vs `dispMin` 0.28). So distance was never the problem —
the `m > inkMin` ink-coverage gate was killing them.

Root cause: `stampEvaluator`'s projected `(u,v)` is only valid *at* the surface.
For raised emboss relief the colorizer evaluated `m` at the raised point, and on
a curved (wrap) projection the radial lift shifts `u` off the letter, so `m`
collapses to ~0 — dropping whole walls. The shift is along the wrap direction,
which is exactly the directional "rectangular notches" pattern the user saw.

### Fix

Dropped the `m`/ink gate for emboss + engrave entirely — displacement alone is
the test. The carve/union only changes geometry where there's ink, so the
displaced set already equals the letters laterally, and untouched skin (incl. the
far side) stays put. Through-cuts keep the ink + depth-band test (material is
removed, so nothing is "displaced"). `evalStamp` is now computed only in the
through branch.

Re-ran the headless measure: missed dropped from **9.1% → 0.4%** (the remainder
is the sub-threshold rim sliver) with **zero bleed**. Browser BOLDE renders
(emboss + engrave, two angles each) confirm full coverage, no notches, clean
boundary against the skin.

### Regression test

Kept the reproduction as `tests/unit/engraveColor.test.ts` (tuned to ~2s: R=10,
res 56): asserts >95% of clearly-raised relief is colored and zero sub-surface
bleed. The pre-fix ink-gated classifier failed this (~9% missed); 5% tolerance
cleanly separates fixed from broken.
