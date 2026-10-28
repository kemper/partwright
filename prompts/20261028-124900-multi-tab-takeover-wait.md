---
session: "01CXxFpQDo4c2MfrSHT7paFF"
timestamp: "2026-10-28T12:49:00Z"
sequence: 7
---

## Human

Asked to resolve conflicts and merge the two follow-up PRs. After the merge
from main, PR-checks e2e shard 6 failed in `multi-tab-lock.spec.ts`.

## Assistant

## Key decisions

**A test race, not a regression.** The "Take control" reload strips
`?takeover=1` with `history.replaceState` late in init. The test sampled
`page2.url()` once right after "Ready", which can land before the strip
on a slow runner. The test passes locally on the same commit and the gate
passed on main. Switched to the auto-retrying `expect(page).not.toHaveURL`,
which still fails if the param is never removed.
