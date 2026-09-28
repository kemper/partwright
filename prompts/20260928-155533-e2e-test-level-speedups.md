---
session: "016qCCKWGNM2LB6Fhb1UL57U"
timestamp: "2026-09-28T15:55:33Z"
sequence: 2
tools: [subagent, git-worktree]
---

## Human

After the sharding PR: proceed with the test-level speedups in their own PR —
share one booted page in engine-only specs, move pure-logic browser specs to
the vitest unit tier, and replace fixed waitForTimeout sleeps.

## Assistant

## Key decisions

**Shared page per file, not per worker**: tests/helpers/sharedPage.ts boots one
editor in `beforeAll` and each converted spec closes it in `afterAll`. A
worker-scoped fixture would share one page across *files* (workers: 1 keeps the
worker alive for the whole shard), coupling unrelated specs to whatever ran
before them under a given shard assignment. Per-file keeps order-dependence
inside one file, where it's reviewable. A failed test restarts the worker, so
the next test's beforeAll boots a fresh page.

**Scope of conversion**: only specs whose tests drive `window.partwright` and
assert on results without depending on sibling-test state. Specs with real UI
flows, IndexedDB/reload dependence, or documented isolation needs (smoke.spec.ts)
keep the per-test page.
