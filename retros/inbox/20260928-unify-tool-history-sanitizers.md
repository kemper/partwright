---
date: 2026-09-28
task: "Complete #914 — remove per-provider tool-history sanitizers, add cross-provider parity test"
pr: 960
---

## Liked
- Proving the sanitizers were dead code *before* deleting them (checked that
  chatLoop rebuilds every request through the builders each iteration, and that
  each builder maps a repaired message 1:1) turned a scary refactor into a
  zero-behavior-change deletion.
- Mutation-checking the new parity test (temporarily bypassing the Anthropic
  repair) confirmed it actually fails. A green test alone proved nothing.

## Lacked
- The repo checkout was stale (pre-merge) when first asked "what's incomplete",
  so an early grep suggested #927's wiring was missing. The fix was to trust
  merged `main` over the local tree: re-fetch before reasoning about merged work.

## Learned
- Defensive "backstops" that run after a canonicalizing pass aren't free: they
  can *mask* a missed repair, which makes a divergence test impossible to
  write. Removing them is what gave the parity test teeth.
- The global known-id matching (in both the old sanitizers and
  `repairToolHistory` pass 2) isn't adjacency-aware. Filed as #961.

## Longed for
- A small shared test helper that normalizes each provider's wire format to a
  common token list. Every future cross-provider AI test will need one.
  `tests/ai-tool-history-parity.spec.ts` has one inline that could be extracted.
