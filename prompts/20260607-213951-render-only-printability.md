---
session: "a7f3c2"
timestamp: "2026-06-07T21:39:51Z"
sequence: 1
---

## Human

Holistic pre-production review of the codebase (via 10 audit subagents),
then: "fix them and group the prs however you think is most appropriate."

Two independent audit agents (relief subsystem + engines/import/export/print)
converged on the same defect: the render-only printability contract is only
half-implemented.

## Assistant

## Key decisions

**Root cause**: `computePrintability` (the viewport pill) correctly treats
`manifoldStatus === 'render-only (not manifold)'` as *unverified* watertightness
rather than a failure. But `analyzePrintability` — the detailed report used by
the Print panel's "Check printability", the auto-warn toast fired on every
STL/OBJ/3MF/GLB export, and the AI `checkPrintability` tool — took only a bare
`isManifold` boolean and unconditionally emitted a `level:'fail'` "Not watertight
— repair before printing." So every colour/SVG relief (deliberately render-only,
verified watertight at build time) tripped a bogus blocker on export and to the
AI agent. This is exactly the false-positive the contract exists to prevent,
just relocated from the pill to the export/AI path.

**Fix**: Added an optional `renderOnly` flag to `PrintabilityOptions`. When set,
`analyzePrintability` reports the watertightness check as `level:'info'`
("unverified — render-only import") instead of `'fail'`, and the wall-thickness
skip message reflects the render-only reason. Both call sites in `main.ts`
(`warnIfNotPrintable` for export, the `checkPrintability` tool) now derive
`renderOnly` from `geo.manifoldStatus`, mirroring `computePrintability`. Chose a
flag over passing the whole stats object to keep `printability.ts` a pure
function over a minimal options bag (its existing contract).

**Export hygiene (related)**: `buildSTL` iterated raw `triVerts` and, unlike the
OBJ and 3MF exporters, never dropped degenerate (zero-area) triangles — a
collapsed triangle writes a zero-length normal and trips slicer "non-manifold
edge" warnings. Routed STL through the shared `cleanMeshForExport` and consumed
its `validTris` (STL is unindexed, so only the degenerate filter is needed, not
the vertex dedup). Now all three mesh exporters share the same cleanup.
