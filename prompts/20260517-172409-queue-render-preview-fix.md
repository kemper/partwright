---
session: "queue-mid-run-message"
timestamp: "2026-05-17T17:24:09Z"
model: claude-opus-4-7
---

## Human

> That generally appeared to work but I didn't see in the message flow
> where my message was ingested; it didn't render in the message history
> despite the AI agent seeming to respond to it

## Assistant

### Diagnosis

The first cut wired the chatLoop drain correctly — the model DID see
the queued message — but the panel didn't render it in the visible
transcript.

Two specific causes:

1. **Tool_result user messages were never added to `state.history`
   mid-turn.** The panel builds `state.history` from
   `onUserPersisted` (initial user msg) and `onAssistantPersisted`
   (assistant msgs). The chatLoop persists tool_result messages
   directly without firing a callback. So the `onUserMessageUpdated`
   callback I added did `state.history.findIndex(m => m.id === msg.id)`
   → `-1` → no insert → `renderTranscript` saw nothing new → no
   bubble. End-of-turn reload eventually pulled it from IDB but by
   then the user's bubble was buried inside the tool_result wrap
   between iterations.

2. **No immediate visual feedback when the user hit Send while in
   flight.** The input cleared, the queue badge appeared, but the
   transcript itself didn't change. From the user's POV, the
   message vanished into nothing.

### Fix

- **Insert-or-update in `onUserMessageUpdated`**: if the merged
  tool_result message isn't in `state.history` yet, insert it at
  the right seq position. After this the merged bubble renders
  mid-turn at the correct location, not just at end-of-turn reload.
- **Pending preview bubbles**: `renderTranscript` now appends faded
  blue user bubbles (amber ring + "⏳ queued — waiting for the
  agent to pause" label) for each block in `state.queuedBlocks`,
  pinned to the bottom of the transcript. The user sees their
  message as soon as they click Send. When the drain fires, the
  queue empties → `renderTranscript` re-runs → preview disappears
  and the real merged bubble takes its place (via the insert in
  `onUserMessageUpdated`).
- **`drainQueuedBlocks` and the manual ✕-clear** both now call
  `renderTranscript` so the preview disappears synchronously instead
  of leaving a stale ghost on screen until the next render.
- **`queueCurrentInput`** calls `renderTranscript` after pushing
  blocks so the preview appears the instant the user hits Send.
