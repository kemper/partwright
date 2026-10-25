---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T00:10:00Z"
tools: [playwright]
sequence: 1
---

## Human

Do both option 1 and option 2 as separate PRs and also test the option 2
performance. (CI follow-up: an e2e shard on the lockdown PR failed in a spec
unrelated to it.)

## Assistant

- `tests/ai-cli-bridge-setup.spec.ts` failed in CI on #1109. Locally it failed
  on plain `main` as well, in 2 of 3 runs, so the bug predates that PR.
- Cause: a race in the test.
  - `addEndpoint` awaits its IndexedDB `putEndpoint` before it selects the
    new entry.
  - So the test's `fill` of the URL landed in the previously selected
    endpoint's form, which then got swapped for the new, empty draft.
  - That left "Use this endpoint" disabled until timeout.
- Fix: wait for the third row to appear before typing, as the test already
  does after adding the second entry. This is test-only; a human can't type
  inside that IndexedDB write window.
- Verified: 5 of 5 passes with `--repeat-each 5 --retries 0`, against 1 of 3
  before.
