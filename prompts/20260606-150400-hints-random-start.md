---
session: "noethr"
timestamp: "2026-06-06T15:02:00Z"
model: claude-opus-4-8
sequence: 5
---

## Human

Does the first hint get picked randomly and then rotate? I feel like I'm seeing
the same initial hint every time.

## Assistant

## Key decisions

**Confirmed the cause.** `buildOrder()` returned unseen hints in *dataset order*
and started at index 0, so the first hint was always the next-unseen one — and
once every hint had been marked seen, it reset to `HINTS[0]` (the ⌘K hint) on
every load. Deterministic, hence the "same initial hint" feeling.

**Fix.** Shuffle each group (unseen, then seen) with Fisher–Yates in
`buildOrder`, which runs on every mount and session change. The first hint shown
is now random — a fresh unseen one while any remain (preserving the discovery
bias), then any once all are seen — and the whole rotation sequence varies too.

No test changes needed; the existing e2e (rotate, restore, coach) still passes
since hints remain distinct and the full set is still present in the order.
