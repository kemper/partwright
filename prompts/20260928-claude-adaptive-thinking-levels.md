---
date: 2026-09-28
branch: claude/quirky-goldberg-b3xl2h
files_changed:
  - src/ai/thinkingLevels.ts
  - src/ai/anthropic.ts
  - src/ai/openai.ts
  - src/ai/custom.ts
  - src/ai/gemini.ts
  - src/ai/chatLoop.ts
  - src/ai/types.ts
  - src/ai/settings.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/ui/preact/settingsModal.tsx
  - src/ui/aiPanel.ts
  - src/content/data/help.ts
  - public/ai/spending.md
  - tests/unit/thinkingLevels.test.ts
  - tests/ai-providers.spec.ts
---

## Human

Fix the Claude thinking requests (the likely 400 on Opus 4.7+), and redo the
Thinking levels as Off / Default / Low / Med / High / XHigh / Max, in one PR.
Add settings where needed and attach visual proof. This is the first PR of a
stack (tracking: kemper/partwright#962).

## Assistant

**Why it was broken.** Anthropic removed `budget_tokens` on Opus 4.7/4.8/5/5.5,
Sonnet 5 and Fable, which now return a 400. They also hide thinking by default,
so a thinking turn is a silent stream. Partwright sent `budget_tokens` for any
level above Off, and the Full preset defaults to Opus 4.7 + High.

**Mapping lives in one pure module** (`thinkingLevels.ts`), so every
model-family × level combination is unit-tested without a browser.

**Claude is classified by model id** into four families:
- **budget** (pre-4.6): the old `budget_tokens` path. XHigh/Max clamp to the
  High budget, because older models cap output at 32–64k tokens.
- **4.6**: adaptive thinking; XHigh rounds down to High; no `display` field,
  since 4.6 already shows its thinking.
- **4.7 / 4.8 / Sonnet 5**: adaptive + effort + `display: summarized`.
  Off sends `disabled`.
- **always-on** (Opus 5.x, Fable, Mythos): these can't be disabled reliably,
  so Off becomes adaptive at `low` effort, as the API guidance recommends.

`display: summarized` is requested so a thinking turn isn't the silent stall
from #959. Adaptive thinking has no budget, so `max_tokens` rises to a new
configurable ceiling of 32768 (Advanced settings). Thinking-block replay now
keys on "will this model think", not `level !== off`, because always-on
models think even at Off.

**Default** sends no depth override. Models that think when the field is
omitted (Sonnet 5, always-on models) still get the adaptive block, so their
reasoning shows.

**OpenAI:** reasoning models always reason, so Off maps to `low` (valid
everywhere) and Default omits the field. XHigh needs gpt-5.2+ and Max needs
gpt-5.6+; both clamp down on older models. The e2e suite caught a regression
here: the Custom provider shared this transport with `thinking: 'off'`, which
would have started sending `reasoning_effort: low`. `thinking` is now omitted
for Custom, and an omitted field means no reasoning request at all.

**Custom:** a new opt-in checkbox sends the level as `reasoning_effort` (Off
becomes `none`, Default isn't sent). It is off by default because Ollama
rejects the field on models that don't think; CLIProxyAPI and vLLM honor it.

**Gemini:** Default shows thoughts with no budget; XHigh/Max use the High
budget, since Gemini tops out at High.

The Full preset moves to XHigh. Old saved levels stay valid, and stored or
session values are validated with `parseThinkingLevel`, so unknown strings
fall back to the default.
