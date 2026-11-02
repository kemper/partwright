---
session: "01QnZGNP"
timestamp: "2026-10-29T02:21:32Z"
---

## Human

When I use the button to walk backward in an AI chat (here because an error
happened), the back button goes all the way back to when I last approved a
plan rather than just unwinding the last tool call or step. I want rewind to
help undo a step that failed on an error, but also to go back incrementally.
The buttons are also very non-obvious. Maybe a skip back and a step back,
followed by a step forward vs skip forward? Skip forward would be a chapter
skip that does large chunks like today. Create a PR.

## Assistant

## Key decisions

**Two granularities, one pure module (src/ai/rewind.ts).** A *step* is one
model request/response cycle: an assistant message plus the tool-result
carrier that answers it, or a single user-authored message. A *chapter* starts
at each human-written message (typed prompt, plan approval, or a follow-up
queued mid-run on a carrier), excluding auto-continue nudges. Old behaviour =
chapter back; the new default granular control = step back. Step cuts always
land on a step boundary, so they never orphan a tool_use.

**Reversible repair.** A chapter cut at a queued follow-up exposes an orphaned
tool_use and the existing silent repair appends a synthetic carrier. The
rewind entry records a `repairUndo` so the next step forward removes the
synthetic carrier and restores the real one — previously fast-forward left
both, losing the real tool results on the next send.

**Ephemeral bubbles are dropped, not restored.** The red error bubble / amber
stop notice ride with the step that failed and are never re-persisted on
restore (the old fast-forward re-put them into IndexedDB).

**Stack hygiene.** The stack is now cleared at turn start (covers Send, Retry,
Keep going, plan approval — before only Send/approve cleared it), on history
reload (session switch / peer tab / compaction), clear chat, /repair and plan
discard, fixing stale-slice restores into the wrong history.

**Discoverability.** Media-player transport group (⏮ ◀ ▶ ⏭ SVG icons,
aria-labels, explicit tooltips) plus a transcript banner while rewound that
says how many steps are hidden and offers "Resume from here" (only when the
tail is a user turn, so it can't become an assistant prefill) and "Restore
all". Chat-only control, so no window.partwright method / AI tool.
