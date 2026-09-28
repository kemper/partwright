---
date: 2026-09-28
branch: claude/openai-tool-result-mismatch-gnqdt8
files_changed:
  - src/ai/anthropic.ts
  - src/ai/openai.ts
  - src/ai/gemini.ts
  - src/ai/local.ts
  - src/ai/historyRepair.ts
  - tests/ai-tool-history-parity.spec.ts
---

## Human

After #927 merged: "Tell me what is incomplete from #914", then "Can you create
a new [PR] doing the remaining tasks?"

## Assistant

#927 met #914's first acceptance criterion (every builder routes through
`repairToolHistory`) but left two things: the per-provider sanitizers were kept
as "backstops" instead of removed (criterion 2), and there was no test proving
all providers repair identically (criterion 3).

**Removed the backstops only after proving they were dead code.** Before
deleting, checked each one against the shared pass rather than assuming:
`chatLoop` rebuilds every request from `ChatMessage` history through the
builders on every loop iteration (no API-shaped messages are appended
mid-turn that could bypass them), and each builder maps a repaired message 1:1
— every toolCall to a call, every toolResult to a result, carrier kept
adjacent. So after `repairToolHistory` the sanitizers could never fire. Their
orphan-result strip used the same global known-id set as the shared pass, and
the Anthropic trailing-tool_use *strip* was already unreachable because the
shared pass *answers* a trailing call instead. Deleted `sanitizeToolUse` +
`stripOrphanToolResults` (anthropic.ts) and `sanitizeChatToolMessages` +
`sanitizeResponsesToolCalls` (openai.ts): ~200 lines, zero behavior change.

**Moved Local's repair into its builder.** It was the one provider repairing in
`streamLocalTurn` rather than inside `buildLocalApiMessages`, which also made
its send path untestable without WebLLM. Now every builder canonicalizes its own
input, and the builder is exported for the test.

**Parity test pins the contract, and was verified to bite.** New
`tests/ai-tool-history-parity.spec.ts` drives one corrupted history through
every provider's real send path (Anthropic, OpenAI Chat, OpenAI Responses,
Custom, Gemini, Local native + prompt-engineered), normalizes each wire format
to an ordered `user:/call:/result:<id>:<kind>` token list (order encodes
adjacency), and asserts every provider equals what `repairToolHistory` itself
produces — i.e. exactly what the Repair button writes back. Two scenarios: a
mid-conversation dangling tool_use plus a compaction-orphaned tool_result; and a
trailing dangling tool_use (the historical Anthropic-strips-vs-others-answer
divergence). Mutation-checked: making the Anthropic builder skip the repair
fails both scenarios with "anthropic diverged from repairToolHistory". That
failure is only possible now that no backstop masks a missed repair.

Typecheck, unit tier (1811), circular-dep gate, and the 45 provider /
tool-result / parity e2e tests green.

Discovered while verifying (pre-existing, out of scope, filed as #961): the
orphan-result pass keeps a tool_result matching a call *anywhere* in history,
not just the immediately preceding assistant turn. Strict-adjacency backends
still 400 on a stray/non-adjacent result while the Repair button reports
nothing to fix.
