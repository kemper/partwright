---
session: "01KueLQi"
timestamp: "2026-10-25T16:09:27Z"
---

## Human

The AI chat shows "Turn failed — 400 messages.36.content.2: unexpected
`tool_use_id` found in `tool_result` blocks … Each `tool_result` block must
have a corresponding `tool_use` block in the previous message", but the
"Repair history" button doesn't fix it.

## Assistant

## Key decisions

**Root cause**: `repairToolHistory` only stripped a tool_result whose id was
unknown *anywhere* in the history. Every provider requires the result to
answer a tool_use in the *immediately preceding* message, so a result whose
call exists further back (a misplaced carrier, a duplicate of an
already-answered call) passed the check — Repair said "nothing to repair" and
the automatic repair-before-send (which every provider builder also runs) was
a no-op, so Retry looped on the same 400. The old doc comment already noted
this gap (#961).

**Fix**: the second pass now enforces strict adjacency (and dedupes ids within
one carrier) instead of global membership; stray results are stripped and an
emptied carrier deleted. Pass 1 reuses a real result found elsewhere in the
history before falling back to the synthetic "interrupted" one, so a misplaced
carrier's actual tool output is moved back next to its call instead of lost.

**Ephemeral messages**: the in-memory error bubble / stop notice are skipped
when finding neighbours, because the manual repair runs on the live
`state.history` and strict adjacency would otherwise strip (and persist the
deletion of) a valid carrier sitting just past an error bubble.
