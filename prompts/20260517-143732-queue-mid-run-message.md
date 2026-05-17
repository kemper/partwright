---
session: "queue-mid-run-message"
timestamp: "2026-05-17T14:37:32Z"
model: claude-opus-4-7
---

## Human

> I'm confused. There is a whole AI pane that opens from the right.
> I just want the ability to type a message and send it while it's
> running. Current, the send button turns into a stop button. You
> seem to have added an input on a older version of the codebase
> I think? Please build from the staging branch and update the PR

## Assistant

### Key decisions

**Build from latest staging**: the prior attempt was scoped against a
pre-AI-chat snapshot of the repo and added a queue input to the
geometry session bar — entirely wrong surface. Reset the branch onto
the head of `origin/staging` (22 commits forward, including the
in-app AI chat at `src/ui/aiPanel.ts` + `src/ai/chatLoop.ts`) and
re-implemented against the actual chat panel.

**Send is always Send; Stop is a separate red button**: the previous
behavior repurposed the same button for both ("Send" → "Stop" while
in flight) which is exactly what made it impossible to type a follow-
up without aborting. Send now keeps the same blue look in both
states; clicking it while a turn is running queues the input instead
of dispatching. A new `⊘ Stop` button materializes to its left
whenever `inFlight` is true.

**Drain inside the agent loop, between iterations**: in
`chatLoop.ts`, immediately after a tool_result user turn is
persisted, the loop calls a new `onDrainQueuedBlocks?: () =>
ChatBlock[]` hook. Returned blocks are appended to the same
tool_result user message (which is then re-persisted) so the model
sees the follow-up as part of the next iteration's input. Merging
into the existing turn rather than inserting a second consecutive
user message keeps Anthropic's turn alternation clean.

**End-of-turn auto-restart for terminal exits**: not every turn ends
on a tool_result seam — a model that just replies with text and
hits `end_turn` exits the loop with the queue potentially still
non-empty. After `runTurnWithStallRetry` finishes, if
`state.queuedBlocks` has anything in it, it fires the loop again
with those blocks as a fresh user turn. This also makes "queue +
Stop" do the obvious thing: the abort exits, the queued message
becomes the redirect.

**In-memory queue, session-scoped**: state lives on the existing
`PanelState` object as `queuedBlocks: ChatBlock[]`. No IndexedDB
persistence — the use case is ephemeral. Queue is cleared on
`setActiveSession` so a follow-up typed in one session doesn't get
delivered to a different chat bucket if the user navigates.

**`onUserMessageUpdated` callback**: when the chatLoop merges queued
blocks into a tool_result message, the in-memory copy in the
panel's `state.history` needs to be replaced and the transcript
re-rendered so the human sees their message land immediately. The
new callback fires for exactly that case and reuses the existing
"Queued message delivered to the AI." transient status flash.

**Queue badge above the input row**: amber dot + truncated preview
of the first queued text + an ✕ to discard. Visible only when
`queuedBlocks.length > 0`. Pending images attached at queue time
get folded into the queue alongside the text so a multimodal
follow-up works the same as a multimodal initial send.

**Regression test**: smoke.spec.ts now pins the contract that Send
keeps its label and Stop is a separate `#btn-ai-stop` element,
hidden by default. Full queue → drain → render flow is verified
manually (it needs a real API key to drive an actual turn).
