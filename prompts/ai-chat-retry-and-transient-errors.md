---
session: "FgPph"
timestamp: "2026-06-07T17:30:00Z"
model: claude-opus-4-8
tools: [explore, Read, Grep, Edit, Write, Bash]
---

## Human

In the AI chat pane, when a turn errors and you click "retry last message", it
seems to undo the entire agent run — even after 30 thinking/tool steps it wiped
all that away and replayed the *initial* message, leaving the model confused
about current state. I was also seeing the chat history be cleared in the UI.
Separately: I got a 500 from the server, but I have "auto-continue" on (the
model should loop until the task is done) — I'd expect that to survive server
errors, and I'm not convinced it does. Investigate, then fix: resume in place
(don't clear history), and make auto-continue ride through transient errors.

## Assistant

## Key decisions

**Two distinct root causes, confirmed by tracing the loop + panel.**

1. *Auto-continue died on any provider error.* `runTurn`'s `catch` around the
   `streamTurn` dispatch (`src/ai/chatLoop.ts`) unconditionally fired `onError`
   + `onTurnComplete({reason:'error'})` and `return`ed — `autoResume` was never
   consulted there, and there was **no** retry/backoff for transient failures.
   Every hosted provider `throw`s on a non-2xx (`OpenAI 500: …`, `Gemini 503:
   …`, Anthropic SDK `APIError`), so a 500 tore the whole agent loop down. (The
   only existing retry, `executeAllWithRetry`/`autoRetry`, is for *tool*
   execution, not API calls.)

2. *Retry re-prompted instead of resuming.* `retryLastUserMessage` walked back
   to the last *text-bearing* user message — which in a 30-step agentic run is
   the **original prompt** (all intermediate user turns are tool-results with no
   text block) — and re-sent it via `sendMessage`, appending a duplicate task
   request on top of all completed work. That both confused the model and, via
   the re-send path's history/bucket handling, made the run look wiped.

**Fix 1 — transient-retry with backoff in the loop.** Wrapped the `streamTurn`
dispatch in a bounded retry loop. A new pure module `src/ai/transientError.ts`
(`httpStatusOf` + `isTransientError`) classifies errors: 408/409/425/429 + all
5xx (incl. Anthropic 529) and network/dropped-stream messages are transient;
4xx auth/validation, missing-key, and user aborts are fatal. Transient failures
back off (exp + full jitter, `abortableSleep` so Stop still cancels) and re-issue
the *same* request **without** consuming an agent iteration; only a fatal error
or exhausting `maxTransientRetries` surfaces `onError`. New config knobs in
`appConfig.ts` (`maxTransientRetries`=4, `transientRetryBaseMs`=1000,
`transientRetryMaxMs`=16000) + advanced-settings fields. Read via `getConfig()`
directly in `chatLoop`, matching the sibling `maxConsecutiveAutoResumes` knob —
so the default applies in the agent Worker (where `getConfig` returns defaults);
the tooltip notes overrides only affect the local provider.

**Fix 2 — resume in place, never re-prompt or clear.** Replaced
`retryLastUserMessage` with `retryFailedTurn`, modelled on the amber "Keep
going" `resumeFromNotice`: it drops only the in-memory error bubble and calls
`runTurnWithStallRetry(..., [])` (empty userBlocks) against the existing,
persisted history, so the model continues from its last tool results instead of
replaying the seed prompt. No `sendMessage`, no history reload, no clear — the
completed work stays intact. Button relabeled "↻ Retry" with a clarifying
tooltip.

**Verification.** New `tests/unit/transientError.test.ts` (classifier) and
`tests/ai-transient-retry.spec.ts` (loop: 5xx-then-success retries & completes;
persistent 503 exhausts the bound then errors; 401 fails fast — no retry).
Manual browser check confirmed the AI Call Log shows `transient, retrying 3/4`,
`4/4`, then `gave up after 4 transient retries`, and the error bubble keeps the
prior message visible with the new Retry button. Build + unit (726) + autoresume
/call-log regressions all green.
