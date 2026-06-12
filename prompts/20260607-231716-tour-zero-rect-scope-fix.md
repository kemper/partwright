---
session: "a7f3c2"
timestamp: "2026-06-07T23:17:16Z"
sequence: 11
---

## Human

PR #494 CI: two tour-entry-points e2e tests failed — the tour opened on step 2
("Modeling Engine") instead of step 1 ("Code Editor"). (A share-link test in the
same shard was flaky and passed on retry — unrelated.)

## Assistant

## Key decisions

**Root cause**: my blanket zero-rect skip in the tour's showStep loop was too
aggressive. `#editor-container` (step 1) can momentarily report a 0×0
`getBoundingClientRect()` at tour start — before layout settles in the
rail-button / landing-CTA entry flows — so the guard skipped it and the tour
opened on step 2.

**Fix**: scope the rect check to steps that have an `openSelector` (the
popover-nested Measure/Paint/Simplify steps — the actual targets of the original
hidden-popover bug). Those still get their popover opened and are skipped only if
they remain 0×0 after opening (tool genuinely absent in this session). Plain
top-level steps keep the original existence-only check, so a valid first step
that briefly measures 0×0 is never skipped. The popover fix (openSelector) is
unchanged.
