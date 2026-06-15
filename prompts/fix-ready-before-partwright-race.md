---
date: 2026-06-15
branch: claude/magical-wozniak-9xjylu
files_changed:
  - tests/multi-tab-lock.spec.ts
  - tests/paint-cancel.spec.ts
  - tests/paint-coverage.spec.ts
  - tests/paint-preview-shapes.spec.ts
---

## Human

"i have failing test on main" — pasted a CI run (shard 2 of 3) where
`tests/multi-tab-lock.spec.ts` hard-failed and three paint specs
(`paint-cancel`, `paint-coverage`, `paint-preview-shapes`) flaked with
`TypeError: Cannot read properties of undefined (reading 'run')` inside a
`page.evaluate`.

## Assistant

Root cause: a boot race in the e2e setup, not a product bug. These specs wait
for `waitForSelector('text=Ready')` and then immediately reach for
`window.partwright`. But the "Ready" status can paint a frame *before*
`window.partwright` is assigned — that wiring (`apiWindow.partwright = …`) lives
near the very end of `main()`, after a top-level await that lets the initial
render set "Ready" first. On a loaded CI shard the status wins the race, so
`pw` is `undefined` and `pw.run(...)` throws `reading 'run'`. The same
anti-pattern explains the multi-tab hard failure (its first `pw.createSession`
on the leader tab races identically); it passed 3/3 locally, consistent with a
load-dependent flake.

The robust specs (e.g. `insert-palette`) already avoid this by waiting on the
API object itself (`waitForFunction(() => !!window.partwright?.help)`) rather
than the status text. Applied the same guard to the four reported specs: after
the existing `text=Ready` wait, a `waitForFunction(() => …partwright?.run)`
before any `page.evaluate` that drives the API (both tabs in the multi-tab
spec). Minimal and proven — kept scope to the four failing specs rather than
rewriting the ~70 that share the `text=Ready` pattern but aren't flaking, since
most don't immediately touch `partwright` and the broad rewrite is a separate
refactor.

Verified: the four specs run 8/8 green (multi-tab also passed 3/3 on repeat
before the change, confirming load-sensitivity); `tsc --noEmit` clean.
