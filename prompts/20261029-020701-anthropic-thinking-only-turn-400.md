---
session: "01QnZG"
timestamp: "2026-10-29T02:07:01Z"
---

## Human

A chat session stopped on a turn with an error, with no fix button; Retry and
Ignore both fail: 400 "messages.43: The final block in an assistant message
cannot be `thinking`."

## Assistant

## Key decisions

**Root cause**: an Anthropic turn that stopped after thinking but before any
text/tool_use (max_tokens mid-thought, empty final, abort) is persisted with
`thinkingBlocks` only. `assistantBlocksToApi` replayed it as an assistant
message consisting solely of thinking, which the API rejects. Because it's
persisted, every Retry rebuilt the same request; the error isn't a
tool-history mismatch, so no Repair button appeared.

**Fix on the send path, not the stored history**: the builder now emits the
signed thinking blocks only when the message carries other content (they still
lead it, preserving the tool_use replay invariant). Prior turns may omit
thinking, so dropping it is safe — and it means the user's stuck chat recovers
on a plain Retry with no migration/repair step. Also skip whitespace-only
assistant text, mirroring the user-side serializer (the API rejects it too).
