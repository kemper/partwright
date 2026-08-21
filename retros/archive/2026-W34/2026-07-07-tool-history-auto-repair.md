---
date: 2026-07-07
author: claude (opus-4-8)
task: Auto-repair tool-use/tool-result mismatch 400 before every AI send/retry (PR #913)
---

## Liked
- The repair *logic* already existed and was well-factored (`repairToolHistory`, pure + unit-tested). The bug was purely a **missing call site** — repair ran after rewind/compact but never before a normal send or Retry. Finding that turned a scary-looking "provider 400" into a one-line fix at the single send choke point (`runTurnWithStallRetry`). Reading the whole recovery surface before touching anything paid off.
- The panel-level e2e that seeds the exact corrupted shape into IndexedDB (`aiChats` store) and drives `/repair` was decisive and network-free — reused the `ai-slash-commands.spec.ts` seeding pattern. It reproduced the user's literal 400 (same `toolu_…` id) and proved the persisted synthetic `tool_result` lands.
- The user's own report contained the fix spec: "auto-fix when detected + a manual option." Mapping those two asks straight onto (send-path auto-repair) + (error-signature-gated button) kept scope tight.

## Lacked
- A single source of truth for the tool-history invariant. There are **four** implementations (Anthropic `sanitizeToolUse`, OpenAI `sanitizeChatToolMessages` global-set, Gemini→shared `repairToolHistory`, and the UI detector→`repairToolHistory`). I burned several turns trying to locate the exact hole that produced the 400 because the send path and the button's detector are different code. Filed as #914.
- The reported error was labeled "OpenAI 400" but carried an **Anthropic**-format body (`toolu_`, `tool_use`/`tool_result`). That's the custom/OpenAI-compatible provider proxying to Claude — a real ambiguity that cost investigation time. A provider-tagged, structured diagnostic (which builder/endpoint actually 400'd) would have removed the guesswork.

## Learned
- The transcript renders an orphaned `tool_use` with a "Tool call did not complete… history was repaired" placeholder **before** any actual persisted repair — a display affordance, not proof of a write. So a test asserting recovery must check the `aiChats` store, not just transcript text.
- `showToast` success messages are a global, fading bottom-center node (NOT inside `#ai-panel`), while `setTransientStatus` writes the panel's status line. A panel-scoped `toContainText` on a success toast silently fails; assert on the persistent transcript/store instead.
- `runTurnWithStallRetry` is the single choke point for every send (sendMessage, retryFailedTurn, resumeFromNotice, plan mode) — the right place to put a once-per-send guard so all entry points inherit it.

## Longed for
- One shared tool-history repair pass applied before payload construction for *all* providers (Gemini already does this), so the UI's "is it broken?" detector and the actual send transform can never disagree. This divergence is the root reason the class of bug is hard to reason about — tracked in #914.
- A provider-diagnostics field that records *which* request builder/endpoint emitted a 4xx and the pre-send message-shape summary, so "OpenAI 400 with an Anthropic body" is unambiguous at a glance instead of an inference.
