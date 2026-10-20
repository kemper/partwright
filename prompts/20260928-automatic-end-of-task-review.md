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

**Review follow-ups** (from a review subagent: 3 blocking, 7 should-fix):
- **Session and ownership safety (blocking).** The review captures its
  session. A session switch or a lost write-ownership during the review means
  no fix round and no push into the wrong transcript; the new session's
  history is reloaded instead.
- **Planning (blocking).** Plan-first turns aren't reviewed. After a plan
  approval, the review grades the ORIGINAL request (it's passed in, not
  inferred). Auto-continue nudges are skipped when the request is inferred.
- **Stop works.** The review runs with its own AbortController in
  `inFlightController`, threaded down to every provider's streamTurn, and is
  shown as in-flight (Stop button, rewind disabled). An aborted review is
  never persisted.
- **"Changed the model"** now means model-changing tool calls in the current
  round (the new `isModelChangingTool` in `tools.ts`), not any tool call.
- **The on/off switch moved to `ChatToggles`** (per window), so the 🔍 pill
  can't turn on paid reviews in another tab. Reviewer choice and fix rounds
  stay global preferences.
- **Caps and gates.** The spend cap is re-checked before each fix round, and
  the copy now says the iteration cap applies per round. A "same" reviewer
  with a Local chat skips with a reason. A declined unpriced reviewer is
  remembered for the session instead of prompting after every task.
- **The follow-up references the review** instead of repeating it (providers
  already replay review blocks), so it no longer doubles the tokens.
- **Queue and verdict.** A human message queued during the review wins over
  the fix round, and fix rounds reset per request. The verdict instruction
  now explicitly replaces the old one-line opener.

**Reference images reach the reviewer (#972).** The user asked whether
attached images get dropped. The automatic review only saw the renders, so a
"make it look like this photo" task was graded without the photo. It now also
sends the images the user attached in this conversation, newest
`reviewReferenceImages` (default 4, Advanced settings, 0 = renders only). That
includes images compaction carried forward. It reuses `carriedAttachments`,
which already picks user-attached images and skips the agent's own renders.
The prompt tells the reviewer they are the user's reference. The e2e seeds an
earlier message with an attached image and asserts that both review requests
carry it. The spec fails with the change reverted.

**On by default (user request).** After trying it, the user asked for review
to be on by default. It is now on in the Standard (default) and Full presets.
Minimal keeps it off, since that preset exists to minimize spend. Saved
settings that have no `autoReview` field pick up the new default. Because
default-on means Local users would see "Automatic review skipped (Local
can't review)" after every task, each skip reason now shows once per page
load. All AI e2e specs plus smoke (105 tests) still pass with review on.
