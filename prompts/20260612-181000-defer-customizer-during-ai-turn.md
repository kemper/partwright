---
session: "elegant-clarke-25f7wu"
timestamp: "2026-06-12T18:10:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 2
---

## Human

The customize menu pops up while the AI is still doing runAndSave / working. I
don't want to auto-hide the AI pane while it's still working, and I'm not sure I
want the customize menu to pop up during that either — that should happen when
the AI is finished.

(Follow-up clarification chosen via question: once the AI finishes a turn that
produced a customizable model, pop the Customizer but KEEP the AI pane open.)

## Assistant

## Key decisions

**Two behaviors, gated on "is a chat turn in flight."**

1. *Don't pop the Customizer mid-turn.* `syncParamsPanel` (main.ts) now records
   the schema immediately but, when `isAiTurnInFlight()` is true, defers the
   panel UI refresh and sets `paramsRevealDeferred`. An `onAiTurnEnd` subscriber
   flushes it once the turn truly ends.

2. *Auto-reveal keeps the AI pane open.* The deferred flush calls the panel with
   `{ silentReveal: true }`, which threads down to a new
   `openViewportPanel(panel, { silent: true })` that skips the open-listeners —
   so the "hide the AI pane on tool open" hook does NOT fire for this reveal.
   Manual tool clicks (and the user-driven, AI-idle reveal) stay non-silent and
   still hide the pane, preserving the original feature.

**Turn lifecycle plumbing.** Exported `isAiTurnInFlight()` (reads `state.inFlight`)
and `onAiTurnEnd(fn)` from aiPanel. The listeners fire at the *true* turn end
(the `return` after `broadcastChatChanged()`), not at the per-iteration
`inFlight = false` — retries and queued follow-ups `continue` the loop and must
not trigger a premature flush.

**Idle vs. in-flight is the discriminator.** A customizable model opened by the
user directly (AI idle) still hides the pane (the original ask); only an
AI-generated model defers + keeps the pane. The two cases are pinned by
`customizer.spec.ts` (idle → pane hidden) and the new
`ai-customizer-defer.spec.ts` (AI turn → pane kept).

**Testing.** Unit-tested the registry's `silent`/listener contract
(`tests/unit/viewportPanelRegistry.test.ts`). For the integration, discovered
Playwright's `page.route` *does* intercept the agent Worker's provider fetch, so
`ai-customizer-defer.spec.ts` drives a real Anthropic turn (stubbed SSE:
tool_use runAndSave of a parametric model → end_turn) and asserts the Customizer
reveals with the AI panel still open. Verified visually with a screenshot.
