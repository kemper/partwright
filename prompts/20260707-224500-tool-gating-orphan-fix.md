---
date: 2026-07-07
branch: claude/serene-ritchie-jfdhv6
files_changed:
  - src/ai/tools.ts
  - tests/unit/toolGating.test.ts
---

## Human

Field report: started an AI session, ran /reconstruct, and the AI replied
"No profileModel/fitInscribed/evalAgainstImport/addSessionNote tools are
exposed to me in this session" and fell back to sliceAtZVisual/query.

## Assistant

Root cause: `buildToolList`'s non-plan filter is a whitelist over the gating
sets with `return false` as the default — a tool defined in ALL_TOOLS but
absent from every set silently never reaches the model. The new measurement
tools were only in RETRY_SAFE_TOOLS (a retry-semantics hint, not an exposure
gate), and `evalAgainstImport` from the already-merged #899 had the same
gap — it was NEVER visible to the chat AI. The user's session was the first
real exercise of that path. (addSessionNote missing was correct behavior —
their session-notes toggle was off.)

Fix: the four measurement tools join ALWAYS_AVAILABLE (pure reads, same
class as query/probeRay) and PLAN_MODE_TOOLS (plans can ground on
measurements). Guard for the whole class: a new unit test asserts every
ALL_TOOLS entry is exposed under fully-enabled toggles (no orphans) and that
plan mode stays a strict read-only subset — this test would have caught both
shipped instances.
