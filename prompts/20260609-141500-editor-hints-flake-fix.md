---
date: 2026-06-09
prefix: test
---

## Human

(PR #534 CI follow-up) The `editor-hints.spec.ts` "a coach CTA pulses an arrow
at the target control" e2e test failed on the PR (initial + retry).

## Assistant

Diagnosed it as a pre-existing flake, not a regression from the ResizeObserver
fix. The ticker's rotation order is shuffled (`buildOrder` → Fisher–Yates), and
there are 24 hints, but the test only clicked "Next hint" 12 times looking for
the BREP hint — so it found it only ~50% of the time (and the retry could miss
too, ~25% of runs fail). The commit history already shows this test being
re-triggered as a known flake (`a4cfb90`).

The ResizeObserver change only touches the observer-driven relayout path;
`advance()` → `showCurrent()` sets the hint text synchronously and is untouched,
so text stepping isn't affected.

Made the test deterministic: step through a full cycle (cap 40) instead of a
fixed 12, stop early once a hint text repeats (a complete loop), and poll for
the text to actually change after each "Next" click before re-reading. Verified
with `--repeat-each=3` — 12/12 green.
