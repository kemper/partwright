---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T14:52:00Z"
tools: [subagent, git-worktree, vitest, playwright]
sequence: 3
---

## Human

Run the audit agent and fix what's missing. I definitely want core operations
available to the agents; not every UI action needs an AI tool, only the ones
that make sense.

(Follow-up: a reviewer of the first PR asked for fixes to confirmation safety,
note-id checks, diff size, group validation, and several nits.)

## Assistant

## Key decisions

**Confirmation fails closed and respects Stop.** The rule is now: the layer that
runs the real `executeTool` enforces confirmation.
- Inside the agent Worker, the loop can't hold a UI callback, so it delegates to
  `agentWorkerClient` on the main thread.
- That client declines when no `confirmTool` callback exists, instead of running
  the tool.
- It also re-checks after the prompt resolves: the turn's signal is not aborted
  and the same turn is still in flight (a per-turn sequence number). An Allow
  that races a Stop therefore becomes `[aborted by user]`.
- The main-thread `chatLoop` path does the same. With no callback and no custom
  `executeToolFn`, it returns `CONFIRM_UNAVAILABLE_MESSAGE`.

**The tool timeout pauses while the user decides.** The client posts
`tool_confirm_pending` / `tool_confirm_done` to the Worker, which disarms the
call's timer and then re-arms it with the full budget. The tool has not started
yet, so restarting the clock is correct. This was simpler than estimating an
extension.

**The prompt says exactly what will happen.** `confirmToolLabel` is now async
and reads the call's input. It produces "permanently delete version 2 'final' of
object Object 1". The version label is looked up only when the target is the
current object, because `listVersions()` reads the current object and focus
switches only after Allow.

The dialog moved onto `modalShell`, which gives it:
- Escape, click-outside and ✕ all decline;
- a focus trap, with focus starting on Decline;
- a danger-styled Allow for deleteVersion;
- dismissal (as a decline) when the turn's AbortSignal fires.

**Note edits are checked against the active session.** `updateSessionNote` and
`deleteSessionNote` write by id with no session check. The tool now requires
the id to be in `listSessionNotes()`. This prevents silent no-ops and edits to
another tab's session.

**Smaller fixes**:
- `computeCodeDiff` caps each line at 200 characters. A voxel bake puts one huge
  data line in the code. This also benefits forkVersion/modifyAndTest.
- `maxDiffLines` and `maxPointsPerStroke` are clamped in dispatch.
- `setObjectGroup` refuses a missing or non-string group; only an explicit null
  or "" ungroups.
- `query` rejects unknown keys and malformed or too many `pointsInside` points
  before calling the API.
- `executeTool` works on a copy of its input, so the retry path reuses the
  original.
- The units descriptions now say the setting is a per-tab preference.

**Tests**: unit tests cover the new validation, the confirm label and
non-mutation of the input. A new e2e spec drives the real panel prompt through
the Worker path (Escape declines, Allow deletes, plus a screenshot). It also
drives the main-thread loop, covering the fail-closed case and Allow-after-Stop.
