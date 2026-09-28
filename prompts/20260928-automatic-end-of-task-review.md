---
date: 2026-09-28
branch: claude/quirky-goldberg-b3xl2h-review
files_changed:
  - src/ai/autoReview.ts
  - src/ai/review.ts
  - src/ai/settings.ts
  - src/ui/aiPanel.ts
  - src/ui/preact/settingsModal.tsx
  - src/content/data/help.ts
  - tests/unit/autoReview.test.ts
  - tests/ai-auto-review.spec.ts
---

## Human

Third PR of the stack (tracking kemper/partwright#962): an optional
automatic review at the end of a task. A fresh-context reviewer grades the
result and returns concrete fixes. Add settings where needed and attach
visual proof.

## Assistant

This reuses the manual 👁 review's `runReview` / `gatherReviewContext` (code,
stats, 4-view render, notes). The new parts are the trigger, a
machine-readable verdict, and a bounded fix loop.

**Trigger.** The review runs when the turn truly ended cleanly (`end_turn`, no
error), the agent called tools (a chat-only reply has nothing to grade), and
the session is under its spend cap. It hooks into the panel's turn runner
after queued messages drain, so it never interleaves with a user follow-up.
The panel stays "busy" during the review, so typed messages queue.
Auto-compaction is deferred until after the review, so the two can't race
over `state.history`.

**Fresh context.** The reviewer sees the user's latest request as its focus,
not the agent's reasoning. That independence is the point, and it's why
"Same model as the chat" is still useful (and is the default: no extra key
needed).

**Verdict and fix rounds.** Auto reviews must open with
`Verdict: pass | minor issues | needs rework`. A non-passing verdict with
rounds left becomes a follow-up user turn. The follow-up inlines the review
text, so every provider sees it verbatim; it doesn't rely on how each one
serializes review blocks. Each round is reviewed again, capped at 3 (default
1). The iteration and $ caps still bound it. A review with no parseable
verdict is advisory only.

**Kept quiet.** Automatic reviews don't write a session note each time; the
transcript and the follow-up already carry them.

**Settings.** On/off (default off), the reviewer (same, or a specific
provider + model), and fix rounds live in AiSettings, since everything runs
on the main thread. A 🔍 Review pill toggles it from the panel.

**No console API added.** There's no existing `window.partwright` surface for
AI chat settings (the same as the other AI toggles).
