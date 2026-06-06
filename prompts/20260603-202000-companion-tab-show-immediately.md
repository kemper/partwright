---
date: 2026-06-03
branch: claude/funny-galileo-C7Gs1
files_changed:
  - src/main.ts
---

## Human

Can we show the second code pane right away rather than have it render after the SCAD processes?

## Assistant

The companion tab strip was only showing after the SCAD compiler finished because of how
the new-session import flow was sequenced. `createSession` calls `setCompanionFiles({})`,
which wipes any pre-registered companions. That forced `applyCompanions` to re-register
them afterward and kick off a second compile — companion tabs appeared only once that
second compile completed (~15–20 s with BOSL2).

Key insight: `importCodePayload` creates the session, then immediately runs the code.
The fix is to register companions between those two steps — after `createSession` (so
they survive the `setCompanionFiles({})` reset) but before `runCodeSync` (so both the
tab bar renders immediately and MEMFS already contains them on the first compile).

Changes:
- Added optional `companions` parameter to `importCodePayload`; after `createSession`
  it registers each companion file and calls `renderCompanionFilesBar()` so tabs appear
  before the compiler even starts.
- Updated `placeImportedCodeFile`'s expendable-session path to pass companions into
  `importCodePayload` and skip the second `applyCompanions()` call (just a
  `saveCurrentVersion()` at the end to persist). This also eliminates the redundant
  second compile that previously happened on every companion-bearing import.
