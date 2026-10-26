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
