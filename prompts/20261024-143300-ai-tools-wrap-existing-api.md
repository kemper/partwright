---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T14:33:00Z"
tools: [subagent, git-worktree, vitest, playwright]
sequence: 2
---

## Human

Run the audit agent and fix what's missing. I definitely want core operations
available to the agents; not every UI action needs an AI tool, only the ones
that make sense.

## Assistant

## Key decisions

**Scope (PR1 of #1085)**: add AI tools only for `window.partwright` methods that
already exist. No new console methods. All changes stay in `src/ai/tools.ts`
apart from the few edits listed below. That way the three sibling PRs
(help() docs, new core API, tool registry) touch different regions. Schemas are
one contiguous block at the end of `ALL_TOOLS`; dispatch is one contiguous block
before `default:`.

**Merged reads instead of 1:1 wrappers**:
- `listAnnotations` merges strokes, text labels and the count. Strokes are
  downsampled (bbox and centroid are always kept), because a raw stroke can carry
  hundreds of points the model does not need to find what the user marked.
- `getMeasurement` always returns the user's interactive measurement. It can
  also take `from`/`to` (point distance) and `at` (Z probe).
- `getPalette` returns the active palette plus `listPalettes()`.
- `query` gains `containment` / `pointsInside` / `componentBounds` / `zProfile`.
  The console `query()` rejects unknown keys, so these are stripped and fanned
  out to their own methods.

**diffVersions returns a line diff, not two sources.** Two full model files in a
tool result are expensive. `includeCode: true` still returns them. The LCS diff
already used by forkVersion/modifyAndTest moved out of `main.ts` into a leaf
module, `src/ai/codeDiff.ts`, so both paths share it rather than duplicate it.
In `main.ts` this is one import plus deleting the function.

**Gates**:
- Always-on, plan-mode and retry-safe: listAnnotations, diffVersions,
  getMeasurement, getViewState, getPalette, getUnits, listSessions.
- Always-on: setUnits (metadata only, also retry-safe) and setObjectGroup (like
  createObject/renameObject).
- SAVE_GATED: mirrorModel, renameVersion, deleteVersion. Rename and delete do
  not run new code, so a `SAVE_NON_RUNNING` set lets them work with only the
  saveVersions scope. mirrorModel also needs runCode, like placeModel.
- deleteVersion is also CONFIRM_REQUIRED, because a deleted version has no
  recycle bin. A deleted object does (restoreObject), and its description now
  says so.
- NOTES_GATED: updateSessionNote and deleteSessionNote.
- `renameVersion` is excluded from `isModelChangingTool`: it only relabels, so
  auto-review has nothing to grade.
- The version and transform tools join `OBJECT_TARGETABLE_TOOLS`, like
  listVersions/loadVersion.

**Confirm-prompt wording**: the decline message was hard-coded to "only call
import tools…", which is wrong for deleteVersion. `confirmToolLabel` and
`declinedToolMessage` now live in `tools.ts`, and chatLoop, agentWorkerClient
and aiPanel use them.

**Left out on purpose**: listSessions is read-only; opening a session from chat
would break the cross-tab isolation rule. Export, palette editing, voxel import
and the other Gap B items belong to the later PRs.
