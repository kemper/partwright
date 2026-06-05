---
date: 2026-06-03
branch: claude/funny-galileo-C7Gs1
files_changed:
  - src/main.ts
---

## Human

Now the initial import works, but when I import a second scad (that has companion files) as a new part, the new part is created but shows no companion file text editor view. I'm also a bit confused and unsure if this is related to the work that you've done but the new part has 2 versions to start. Almost like we created a new version off of Part 1? Part has a version "v1/1 - v1" but the new part has version 1 as "v1/2 - v1" and the second is "v2/2 - imported".

## Assistant

Two distinct bugs, both caused by the same structural issue: companions being applied via a
separate `applyCompanions()` call AFTER the placement function had already saved a version.

**Bug 1 — two versions per new part**: `seedNewPartWithCode` → `applyCodeToCurrentPart` saves
version 1 (with no companions). Then `applyCompanions()` registers companions, re-runs, and
calls `saveCurrentVersion()` which saves version 2. One import created two versions.

**Bug 2 — no companion tabs**: `applyCodeToCurrentPart` → `saveVersion` (without companions)
→ `onStateChange` fires `setCompanionFiles({})` (companion registry cleared because the saved
version has empty companions). `applyCompanions` then registered companions and rendered the
bar, but the `runCodeSync` inside triggered another `onStateChange` that could clear again.

The fix threads `companions` through `applyCodeToCurrentPart` and `seedNewPartWithCode`:
- After `switchLanguage`, call `setCompanionFiles(companions)` + `renderCompanionFilesBar()`
  so tabs appear before the compile starts.
- Pass `companionFiles: companions` to the `saveVersion` call so companions are persisted
  in the single version that function already creates.
- Removed the trailing `applyCompanions()` for the `new-part`, `current-part`, and
  `new-session` targets — each path now handles companions internally, single compile, single
  version.
- The `companion-file` target (which attaches a file to an existing part) still uses
  `applyCompanions(self)` unchanged since it doesn't go through the placement functions.
