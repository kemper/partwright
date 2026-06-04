---
session: "fix-diagnostic-log-test-nbjcu"
timestamp: "2026-06-04T17:43:11Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 1
---

## Human

A failed main→staging gate build needs fixing. The e2e test
`editor live errors › transient typing errors stay out of the diagnostic log`
fails: after typing bad code, the `#diagnostics-panel` contains
`zzznotdefined123` (surfaced via "Recent geometry runs ... error · zzznotdefined123 is not defined").

## Assistant

## Key decisions

Root cause: the recent `refactor: fold worker health into the diagnostics panel`
(bfd25d2) merged the worker-telemetry view (incl. the "Recent geometry runs"
ring buffer) into the same `#diagnostics-panel` surface as the diagnostic log.
The run-history legitimately records *every* geometry run, failed auto-runs
included — that's telemetry, distinct from the user-facing error log the test
guards. The test's own header comment scopes its intent to "the diagnostic
log," but its assertion checked the whole panel, so it became over-broad after
the refactor.

Decided this is a stale test, not a behavior regression: keeping failed runs in
the run-history is desired (it's debugging telemetry). Fix is to scope the
assertion to the log half.

- Gave the log list element a stable id `diagnostics-log-list` in
  `diagnosticsPanel.ts`.
- Pointed the test's `not.toContainText` assertion at `#diagnostics-log-list`
  instead of the whole panel, with a comment explaining the upper/lower split.

Verified: build + unit (640) green, all 3 `editor-live-errors` specs pass, and
a scratch screenshot confirmed the LOG section stays clean while the error
appears only in the inline editor panel / run history.
