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

**Fixed sleeps → condition waits** (11 files, ~150 s of sleeps; only one
150 ms margin kept): waits target the real signal, e.g. engine ready, the
part id flipping after the fire-and-forget "+" click, `waitForPaint()` for
subdivision, `session.workCamera` landing, or version counts. Post-save-modal
version counts are read through read-only `db.ts` `listVersions` because
polling via `changePart()` raced the app's own background save loop.

**Close-out**: retro at retros/inbox/*-e2e-suite-speedup.md; leftovers (timings refresh + automation, Vite watch-ignore for worktrees, fake-indexeddb, reset primitives for brep/voxel-studio/stl-import) filed as #974.

**Review-pass fixes** (a work-reviewer found two tests that could no longer
fail for the bug they guard):
- Negative checks got their observation windows back: the version-switch
  camera check waits 800 ms, longer than the 300 ms auto-run debounce it
  guards. "Save current part only" and the export-warning toast check each
  hold 1.5 s before asserting nothing else happened.
- Shared-page files clear paint wherever a test's premise is "no user paint"
  (model-declared-color export, render-edge-modes, …), because `pw.run()`
  keeps existing paint.
- Mixed files wrap their shared tests in a describe that owns
  beforeAll/afterAll, so the shared editor is closed before the per-test UI
  tests start (never two WASM pages alive, which is why workers: 1).
- Back-to-back part-row clicks keep a bounded settle, since selectPart's
  tail exposes no completion signal; an idle hook is tracked in #974.
- Also fixed a pre-existing race CI surfaced in paint-controls-extended
  (evaluating `partwright.run` right after "Ready", before the API exists),
  and refreshed tests/e2e-timings.json from this PR's CI run.
