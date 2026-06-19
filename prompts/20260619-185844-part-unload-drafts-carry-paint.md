---
session: "part-unload-preserve-paint"
timestamp: "2026-06-19T18:58:44Z"
model: claude-opus-4-8
---

## Human

If I paint and then click the "+" button to create a new part it still loses
the paint operation I just completed. I imagined an "unload part" lifecycle that
auto-saves/preserves properly, rather than save calls embedded ad-hoc in UI
handlers. Confirm/deny + fix. [Chosen approach: drafts carry paint.]

## Assistant

## Key decisions

Confirmed the diagnosis: preservation was hand-wired per UI handler. Rail-switch
(`selectPart`) calls `preserveCurrentEditsIfNeeded()` (saves a version WITH
paint), but ➕ (`onCreatePart`) only stashed the CODE draft (no paint) and then
`startNewPartInEditor` → `dropPaintState()` wiped the regions. Per-part drafts
never carried paint, so painting then ➕ lost it.

Fix (drafts carry paint — keeps the part "unsaved"/listed in the save-all modal
while preserving its paint):
- `SessionDraft.colorRegions?: unknown[]` (IndexedDB-only, no schema bump);
  threaded through `setDraft`/`writeDraft`/`readDraft` (typed
  `SerializedColorRegion[]` at the sessionManager layer).
- `partSaveState`: a draft whose paint differs from the saved version (or a
  never-saved part whose draft has paint) is now `'unsaved'`, so the modal lists
  it.
- `main.ts`: `currentDraftRegions()` helper stashes `serializeRegions()` at all
  5 `writeDraft` sites; `restoreDraftIfNewer` replays the draft's paint via
  `rehydrateColorRegions` — re-running code only when it actually changed (no
  double render) and rehydrating paint only when the draft carries it (so it
  never wipes a loaded version's paint).
- The ➕ stash guard became `(!isStarterCode(getValue()) || hasColorRegions())`
  so a painted STARTER part also stashes (the original bug's exact case). The
  API `createPart()` path still doesn't stash (intentional clean slate).

Implemented via an `implementer` subagent in an isolated worktree; reviewed the
diff and re-verified in the main checkout. New `tests/part-unload-paint.spec.ts`
(paint→➕→switch-back restores paint; save-all captures it; survives reload);
typecheck + unit (1508) + parts + save-all-parts all green. Fixes #736.
