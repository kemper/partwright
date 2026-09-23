---
date: 2026-07-19
branch: claude/openai-tool-result-mismatch-gnqdt8
files_changed:
  - src/ai/openai.ts
  - src/ai/anthropic.ts
  - tests/ai-providers.spec.ts
---

## Human

Seeing repeated OpenAI 400s in the AI chat — "messages.36: `tool_use` ids were
found without `tool_result` blocks immediately after: toolu_018Jnf…,
toolu_01LF…" — and the "Repair history" button does nothing. Make the history
repairable.

## Assistant

Root cause is issue #914's predicted divergence. The `toolu_`-prefixed ids +
Anthropic-shaped error mean the user runs an OpenAI-compatible gateway that
proxies to Claude, so the backend enforces strict tool_use/tool_result
adjacency. Two things combined:

1. **The concrete 400 trigger:** OpenAI's `tool` role can't carry an image, so a
   rendered tool-result (renderViews) surfaces its image on a *following* `user`
   message. In a multi-tool turn where an earlier result carries an image and a
   later one doesn't, that image message got emitted *between* the `tool`
   messages — so the later tool_use was no longer "immediately after" its
   result, and the strict backend rejected it (naming BOTH ids). The native
   Anthropic builder never hit this because it embeds the image *inside* the
   `tool_result` block, keeping results contiguous.

2. **Why the button looked broken:** the persisted ChatMessage history was
   *clean* — results present and adjacent at the message level — so
   `repairToolHistory` (what the button and pre-send auto-repair use) correctly
   found nothing to fix. The divergent per-provider builder was the bug, not the
   stored history. Verified in-browser: `repairToolHistory(history).changed ===
   false` while the built request interleaved the image between the tool
   results.

Fix (implements #914's proposal):

- **Keep tool-result messages contiguous.** In `buildChatMessages` (Chat
  Completions) and `buildResponsesInput` (Responses), emit every `tool` /
  `function_call_output` first, then the image side-messages after. Verified the
  built order is now `assistant → tool(A) → tool(B) → user[image]`.
- **Single source of truth.** Route `buildChatMessages`, `buildResponsesInput`,
  and Anthropic's `buildApiMessages` through the shared `repairToolHistory` on
  the ChatMessage history before payload construction (as Gemini/Local already
  did), so "what the Repair button detects" and "what the send repairs" can't
  diverge. The per-provider block-level sanitizers stay as thin backstops (now
  no-ops on already-repaired history).

Added two `ai-providers.spec.ts` regression tests asserting both OpenAI paths
keep tool results contiguous when an earlier result carries an image. Full unit
tier (1776) + 7 provider tests green; typecheck and circular-dep gate clean.
