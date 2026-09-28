---
date: 2026-09-28
branch: claude/quirky-goldberg-b3xl2h-caching
files_changed:
  - src/ai/anthropic.ts
  - src/ai/chatLoop.ts
  - src/ai/historyElision.ts
  - src/ai/thinkingLevels.ts
  - src/ai/settings.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/ui/aiPanel.ts
  - tests/ai-history-caching.spec.ts
  - tests/ai-providers.spec.ts
  - tests/unit/anthropicHistoryCache.test.ts
  - tests/unit/historyElision.test.ts
  - tests/unit/thinkingLevels.test.ts
---

## Human

Second PR of the stack (tracking kemper/partwright#962): cache the
conversation history, trim old render images in steps, and turn auto-compact
on by default. Add settings where needed and attach visual proof.

## Assistant

**Caching.** Only the system prompt and tools were cached, so every agent step
re-billed the whole history at full price. Two message breakpoints were added:
- the **last message**, which writes the cache;
- the **previous user message**, which is exactly where the prior request
  wrote. That makes the read hit even when one step appends more blocks than
  the API's ~20-block lookback.

Together with system + tools that makes four, Anthropic's maximum. The setting
lives in app config because the chat loop runs in the Worker, and app config
is already threaded there.

**Stepped trimming.** Trimming an image edits an earlier message and breaks
the cache from that point on. `imagesToElide` is stateless, so each iteration
recomputes the same answer: it lets images reach 15, then cuts back to 8, so
the elided set changes once per 8 renders. Only providers that cache use it
(Anthropic with caching on, OpenAI, Gemini). Custom and Local keep the tight
3-image window, since they get no dependable discount.

**Auto-compact.** The "conservative" mode only shows a hint, so the real "on"
default is `standard` (renamed "Auto"). 70% of a 1M-token window is ~700k
tokens, far too late given cache-miss cost, so Auto also fires at an absolute
150k-token ceiling (configurable). A stored `off` from before `settingsRev` 1
is almost always the old default, so it migrates once; any later choice
sticks.

**Found while implementing.** Anthropic's preserved-thinking check (Opus 5.5 /
Fable 5.1; enforced for accounts created on or after 2026-08-31) rejects
thinking blocks whose earlier history was edited. Partwright's image trimming,
keep-tail compaction and mid-chat model switches all edit history. For
always-on models the request now sends
`block_binding.prefix_mismatch_behavior: drop_block` with the beta header, so
the API drops those blocks instead of returning a 400. Models that don't run
the check accept the field.
