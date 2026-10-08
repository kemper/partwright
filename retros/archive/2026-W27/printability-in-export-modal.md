# Retro: printability warnings into the export modal

**Task:** Move design-for-print warnings from a fleeting export toast into the export confirm modal (PR #763).

## Liked
- Two clean, well-documented printability systems already existed (`computePrintability` for the pill, `analyzePrintability` for the detailed report) with a stable `PrintabilityCheck` shape — folding the report into `ExportWarningInfo` was a small, low-risk diff.
- The existing `exportConfirmModal.ts` block conventions (tailwind classes, per-warning blocks) made the new section drop in consistently.

## Lacked
- Nothing major. The `main.ts` NUL-byte caveat didn't bite this time since edits were in plain-text zones.

## Learned
- There are TWO separate "disconnected components" surfaces: a run-time toast (engine source, fired on run, covered by `printability-toast.spec.ts`) and the export-time path. Easy to conflate — only the export-time `warnIfNotPrintable` toast was in scope; the run-time one must stay untouched.
- `pull_request_read` `get_status` returns legacy commit-status (empty here → misleading "pending"); `get_check_runs` is the real CI signal for this repo's Actions-based checks.

## Longed for
- A shell-accessible `gh`/CI-status probe in web/remote sessions. Without it, waiting on e2e shards meant arming Monitor timers and re-querying via the GitHub MCP tool by hand — a `send_later`-style self-wake or a `gh pr checks` equivalent would make the post-push watch loop one step instead of several.
