---
session: "014rCfvY"
timestamp: "2026-09-27T18:14:10Z"
sequence: 2
---

## Human

We should not fall back to a generic price. If we don't have real model
cost data then we should warn users that we don't know the price and ask
them to authorize to continue.

## Assistant

## Key decisions

**No guessing at all**: removed both the $3/$15 median fallback and the
family-based pricing added in the previous commit — a same-family price is
still a guess. `turnCostUsd` / `estimateTurnCostUsd` now return `null`
for an unpriced hosted model, so the type checker forces every caller to
handle "unknown" instead of silently summing $0.

**Authorization gate in `preflightTurn`**: every panel entry point (send,
plan approval, retry, resume) goes through it, so one check covers them all;
the review modal calls the same helper before `runReview`. Declining
leaves the message in the input and makes no request. Authorization is held
in module memory per (provider, model) — per tab, for the page's lifetime —
so one tab's approval can't authorize spend in another.

**Honest display**: unpriced assistant turns persist `costUnknown: true`
(optional field on ChatMessage, back-compat) instead of `costUsd`; the
transcript says "cost unknown", the session total becomes "≥$X" with a
tooltip, the next-turn hint and turn-outcome line say "cost unknown".

**Pinned real prices for ids we ship**: `gpt-5-mini` (the OpenAI default),
`gpt-5`, `gpt-5-nano`, `gemini-2.5-flash`, `gemini-2.5-pro` had aged out
of the snapshot; without them every OpenAI user would hit the prompt on the
default model. Rates are copied from earlier models.dev snapshots in git
history, not estimated. A unit test now asserts every default/picker model
is priced. Legacy type-only ids (o3, gpt-4.1, gpt-4o, gemini-pro-latest)
were never in any snapshot and stay unpriced.
