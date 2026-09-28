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

**Pure-logic browser specs → vitest**: Node 22's native fetch/Response/
ReadableStream let the provider request-builder, SSE, tool-history-parity and
persist tests run in the unit tier with `vi.stubGlobal('fetch')` (37 tests;
assertion count preserved). Tests that drive `chatLoop.runTurn` stay in
Playwright: it persists through IndexedDB, and adding `fake-indexeddb` as a new
devDependency for ~8 tests wasn't worth it in this pass.

**What stayed per-test (engine batch)**: brep-integration (the replicad
Worker's retained `lastShape` is never cleared, and one test asserts there is
none), voxel-studio (paint mode is activated but never deactivated, and one
test asserts "not active"), and stl-import (relies on a fresh editor buffer that
still holds starter code, which only a real reload restores). Each of these needs
a reset primitive that doesn't exist today, so they keep their fresh pages.
Retired manifold-id-verify.spec.ts, whose header planned its own deletion
once labelled construction shipped.

**Paint/worker batch**: converting fork-color-carry surfaced that
`createSession()` keeps the live paint regions, so shared-page paint specs call
`clearColors()` after it. The helper's doc comment now lists the state a fresh
goto resets but the API equivalents don't. Tests that toggle the paint panel
with no symmetric teardown (and all of paint-camera-passthrough) stay per-test.
