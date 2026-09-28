---
session: "01ErtAB4"
timestamp: "2026-09-28T12:00:00Z"
---

## Human

When using Opus 5.5 I get the error `400 invalid_request_error: "thinking.type.enabled"
is not supported for this model. Use "thinking.type.adaptive" and
"output_config.effort" to control thinking behavior.` I'd like to fix that, and if
there is a generic way to prevent future model/API errors (or know that I'm
incompatible ahead of time, like when we refresh the catalog) I'd like to consider a
more general fix. If it's just that APIs update and we have to keep up, I can accept
that. — Please implement a fix and create a PR.

## Assistant

## Key decisions

**Root cause**: `streamTurn` in `src/ai/anthropic.ts` always sent
`thinking: {type:'enabled', budget_tokens}` whenever the thinking pill was on. That
shape is removed on Opus 4.7+, Sonnet 5, Opus 5.x and Fable (400), and only
deprecated on 4.6. Opus 5.5 isn't in the committed models.dev snapshot yet, so any
catalog-only fix would still have failed for it.

**Three-layer resolver instead of a hardcoded list** (`src/ai/anthropicThinking.ts`):
1. *Learned from the API* — on a 400 whose message is about the thinking shape,
   `streamTurn` flips shape, retries once, and remembers it for the session. A 400
   arrives before any stream output, so the retry is invisible to the UI. This is the
   generic "API changed under us" self-heal.
2. *Catalog* — the models.dev snapshot already carried `reasoning_options`
   (`budget_tokens` vs `effort` levels) that `catalog.ts` was discarding; it's now
   exposed as `effortLevels` / `budgetTokens` capabilities. `budget_tokens` listed →
   budget (Opus 4.5 lists effort too but doesn't support adaptive, so "has effort" is
   NOT "adaptive"); effort-only → adaptive.
3. *Name heuristic* for ids the snapshot lacks: known ≤4.5 families → budget,
   everything else → adaptive, because every Claude model since 4.6 is adaptive-first.
   Defaulting unknowns to the newer shape is the forward-compatible bet.

**"Know ahead of time at catalog refresh"**: a unit test asserts every Anthropic
reasoning model in the snapshot records a shape we can send and that adaptive models
accept low/medium/high effort. The weekly refresh PR runs the unit tier, so a new
model with an unfamiliar reasoning shape fails there rather than in a user's chat.

**Adaptive request shape**: `{type:'adaptive', display:'summarized'}` +
`output_config.effort` = pill level. `display:'summarized'` because newer models
default to omitted (empty) thinking text, which would leave the live thinking box
blank. The configured budget still sizes the `max_tokens` floor in adaptive mode so
reasoning room is comparable to before.

**Skipped**: 'off' on always-thinking models (Opus 5.x, Fable) still omits the param,
which those models run as adaptive at their default effort — unchanged behavior, not
this bug. A true "can't disable thinking" UI hint is a separate concern.
