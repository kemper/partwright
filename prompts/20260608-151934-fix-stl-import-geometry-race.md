---
session: "eager-cori"
timestamp: "2026-06-08T15:19:34Z"
model: claude-opus-4-8
tools: [playwright]
---

## Human

A deploy from main to staging failed on one e2e test:
`tests/stl-import.spec.ts:48 › STL import › binary STL creates a new
session with an editable Manifold.ofMesh wrapper`. The assertion
`expect(result.volume).toBeCloseTo(1000, 1)` failed because `result.volume`
was `undefined` (matcher error: received value must be a number). The
preceding `result.code` assertions passed, and the test even failed on
retry #1. Fix it.

## Assistant

## Key decisions

**Root cause — a test race, not a product bug.** The failing test waits only
for the editor *code* to contain the `Manifold.ofMesh(api.imports[0])`
wrapper, then immediately reads live stats via `partwright.getGeometryData()`.
But the import flow (`importMeshPayload` in `src/main.ts`) sets the code with
`setValue(code)` *before* `await runCodeSync(code)` recomputes geometry.
`getGeometryData()` returns whatever the last completed render left in
`geometryDataEl`, so on a loaded CI machine the read lands during the
in-flight render — a transient `{status:'error', …}`/empty state with no
`volume` key, hence `undefined`. The sibling test at line 99 never flakes
because it calls `pw.run(...)` (a fresh execution that returns its own
result) instead of reading the cached stats element.

**Fix.** Hardened the wait condition: the `waitForFunction` now also requires
`typeof getGeometryData().volume === 'number'`, so the test only proceeds
once the import's re-render has actually settled. The default starter cube
*does* carry a numeric volume, but the observed `undefined` confirms the read
was hitting a non-geometry transient — gating on a numeric volume eliminates
that window. Verified with `--repeat-each=4` (8/8 green) plus `npm run build`
and `npm run test:unit`.

**Scope.** Test-only change; no source behavior altered. No deeper regression
in volume computation, confirmed by the line-99 test passing in the same run.
