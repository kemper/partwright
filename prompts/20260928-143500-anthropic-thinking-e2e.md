---
session: "01ErtAB4"
timestamp: "2026-09-28T14:35:00Z"
sequence: 2
---

## Human

Create a PR that addresses the follow-up issue (thinking-Off on always-thinking
models + the 8192 Anthropic output cap), including raising 8192 to 32k.

## Assistant

## Key decisions

**Test the #963 behavior in #963 first.** Before stacking the follow-up, added an
e2e case to the fix PR itself: an id the catalog snapshot doesn't carry
(`claude-opus-5-5`) must send `{type:'adaptive', display:'summarized'}` +
`output_config.effort`, and a budget-shape model whose API answers with the
adaptive-only 400 must retry exactly once with the adaptive shape. Stubbing
`fetch` in the browser exercises the real SDK error classes, which a vitest unit
test couldn't (the resolver is unit-tested; the retry path needs the SDK).
