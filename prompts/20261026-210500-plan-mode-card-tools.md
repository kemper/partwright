---
session: "012KuBZA"
timestamp: "2026-10-26T21:05:00Z"
sequence: 3
---

## Human

(Continuation: PR 2 of the plan-mode improvement — structured questions and plans.)

## Assistant

## Key decisions

**Two card tools that end the turn.** `askUser` (questions with clickable options) and
`proposePlan` (summary / steps / assumptions). Frontier models are reliable at structured tool
calls on every hosted provider, so the panel can render real UI instead of guessing from prose.
`executeTool` validates the input and returns a fixed acknowledgement, and the chat loop ends
the turn after the batch (like `finish`, but regardless of auto-continue). Using a normal
acknowledged tool result keeps tool_use/tool_result pairing valid on every provider; the
user's answer arrives as an ordinary next user message.

**askUser in every mode, proposePlan only in plan mode.** Clarifying questions help ordinary
build chats too. A plan card outside plan mode would have no Build bar and could stall a build.

**Fallback.** Small custom/local tiers don't get these tools (their tool lists are trimmed), so
the PR 1 text heuristic still drives the plan bar there. The plan-mode prompt says to use the
tools "if you have them", otherwise text.

**State from the transcript.** The pending plan is derived from history (last typed user
message is a plan request or revision), so the bar survives a reload or a take-control. It isn't
re-derived during a turn (auto-compaction can reload before the request is persisted); the plan
send path re-syncs when the turn ends.

**Answers go through sendMessage.** The card writes the answers (plus anything typed) into the
input and sends, so plan-mode refinement, queueing and owner checks apply unchanged. A single
single-choice question sends on click.

**Auto-review** skips turns that end waiting on an askUser card: the work is paused, not done.

## Assistant (review follow-up)

A review pass found nine problems; all fixed in the follow-up commit.

- **Repeated call ids**: Gemini and local number tool calls per response, so cards are keyed by
  message id + call id (live check, selections, refresh), not call id alone.
- **Answering a mid-build question with the Plan pill on** went down the plan path. A message that
  answers a pending askUser card (and no plan is pending) now continues the build with full tools.
- **Plan markers**: queued messages during a plan turn, and image-only plan messages, now carry the
  plan prefix, so the transcript-derived pending plan doesn't vanish.
- **Rewind / fast-forward** re-derive the pending plan.
- **Viewer tabs**: plan bar and cards are owner-only, and Build/Discard check ownership.
- **Rejected card calls** don't count; only a card whose tool result is the acknowledgement does.
- **Exit from a stale plan**: turning the Plan pill off leaves plan mode (messages kept), and a
  pending plan is restored from the transcript only while the pill is on. Chosen over a third bar
  button because it reuses the control that already means "plan mode", and it persists.
- **Consecutive user turns**: Gemini and the local prompt-engineered builder now merge a tool-result
  turn with the typed turn after it; askUser makes that sequence the normal path, not a corner case.
- Chips get 44 px touch targets on mobile, hover gated on `(hover: hover)`, and keep focus on toggle.
