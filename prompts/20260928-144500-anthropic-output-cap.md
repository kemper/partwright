---
session: "01ErtAB4"
timestamp: "2026-09-28T14:45:00Z"
sequence: 3
---

## Human

Can you create a PR that addresses issue 964 (thinking "Off" still thinks on
Opus 5.x / Fable; the 8192 max_tokens cap can truncate turns; the stale tooltip),
including increasing 8192 to 32k as you suggested?

## Assistant

## Key decisions

**32K default, not per-model limits.** `max_tokens` is only a per-response
runaway guard (you're billed for generated tokens, not the ceiling), and we
stream, so the old "HTTP timeout" rationale for 8K no longer applies. 32K leaves
room for reasoning + a big model-code tool call while still bounding a runaway
response. On top of that, `max_tokens` is now clamped to the model's catalog
output limit, so a user-set value above what the model can emit no longer 400s.

**"Off" on models that can't stop thinking → `effort: 'low'`.** Opus 5.5 and
Fable 400 on `{type:'disabled'}`; Opus 5 / Sonnet 5 accept it but Anthropic
documents failure modes (tool calls written as text, leaked tags) and advises low
effort instead. So Off keeps omitting `thinking` and adds the lowest effort.
Detection (`anthropicThinksWhenOff`): adaptive-shape models that aren't 4.x —
4.6–4.8 genuinely run without thinking when it's omitted; newer families are
assumed to think by default.

**Replay thinking blocks for those models even when Off.** The model still emits
signed thinking blocks; dropping them strips the reasoning chain every turn and,
under preserved thinking, removing blocks mid-history can 400. Replaying on the
same model is Anthropic's standard pattern.

**Not migrating saved settings.** The advanced-settings store is a full snapshot,
so users who ever saved any advanced setting keep 8192. A "treat the old default
as unset" migration would also erase a deliberate 8192 on every reload; noted in
the PR instead.

**Stacked PR.** Depends on `anthropicThinking.ts` from the thinking-shape fix, so
it targets that branch rather than main.
