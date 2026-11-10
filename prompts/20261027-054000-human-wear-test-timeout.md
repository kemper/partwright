---
session: "01U8g7w9"
timestamp: "2026-10-27T05:40:00Z"
sequence: 7
---

## Human

(Overnight run of kemper/partwright#1151.) PR-checks `build-unit` failed on the step-3 PR.

## Assistant

## Key decisions

**Not a defect: the test timed out.** The every-item test builds 32 worn items,
including two footwear SDFs each. It finished in ~4 s locally but passed
vitest's 5 s default on a loaded CI runner. The heavy human-wear tests now
take an explicit 60 s timeout. The work they do is the real assertion, so
they weren't trimmed.
