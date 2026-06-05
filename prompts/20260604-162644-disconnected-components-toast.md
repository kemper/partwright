---
session: "vibrant-goodall"
timestamp: "2026-06-04T16:26:44Z"
model: claude-opus-4-8
---

## Human

When the "X disconnected components" warning shows I want it to be a toast that
goes away and is recorded in the diagnostic menu like other toasts. I also want
it to render wherever other toasts render.

## Assistant

## Key decisions

**Where it lived before**: `computePrintability` returns a list of issues, and
`updateGeometryData` (`src/main.ts`) joined them into the persistent viewport
**printability pill** (`printabilityIndicatorEl`, top-left overlay). The
disconnected-components warning was one of those issues; it stayed up as
standing status and was never recorded in the Diagnostic Log.

**Change**: In `updateGeometryData` I split the `${n} disconnected components`
issue out of the pill. The pill now renders only the remaining issues (e.g.
"non-manifold mesh (not watertight)"), which are genuine standing status. The
disconnected-components warning is emitted via `showToast(..., { variant:
'warn', source: 'engine' })` — bottom-center where every other toast renders,
fading after the standard duration, and (because `showToast` mirrors warns to
`errorLog`) automatically recorded in the Diagnostic Log.

**De-dup**: `updateGeometryData` fires on every run / simplify / paint-apply, so
toasting unconditionally would spam an unchanged broken model. A module-level
`lastDisconnectedWarning` tracks the last text toasted; we only toast when it
changes, and reset it to `null` when the warning clears (including on the run
error path) so the next occurrence toasts again.

**Scope**: Kept narrow to exactly the disconnected-components case the user
named. The non-manifold warning stays on the pill as standing status, matching
the "persistent status ≠ transient notification" guidance in CLAUDE.md (the
pill principle still holds for the issues that remain on it).

**Verification**: Added `tests/printability-toast.spec.ts` — runs two
non-overlapping cubes, asserts the bottom-center `role=status` toast carries the
warning, the pill does not, and the Diagnostic Log captured it as a WARN row.
Manually confirmed in the browser via screenshot (toast bottom-center, amber
warn style, Diagnostics badge incremented).
