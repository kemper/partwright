---
date: 2026-07-07
branch: claude/tool-use-result-mismatch-3lkugi
files_changed:
  - src/ai/historyRepair.ts
  - src/ui/aiPanel.ts
  - tests/unit/historyRepair.test.ts
  - tests/ai-tool-history-repair.spec.ts
---

## Human

Using the AI pane, hit a recurring provider 400 about a mismatch between tool
call ids and tool results ("`tool_use` ids were found without `tool_result`
blocks immediately after: toolu_…"). There's a Retry and a Dismiss on the error,
but I thought we'd built an auto-fix (either a clickable one or something that
just fixes it whenever this is detected). Tried the rewind/undo button to step
back to a healthy point in the chat, but that didn't recover it. Want it fixed
automatically if possible, and also a manual option to fix it.

## Assistant

Root cause: the tool-history repair (`repairToolHistory`) already existed and was
wired into rewind, compaction, and the explicit `/repair` command — but it never
ran before a *normal send* or the *Retry* button. So once an interrupted turn
(Stop, stall watchdog, spend cap, crash, mid-turn session switch) left an
orphaned `tool_use` persisted in history, every subsequent send — including
clicking Retry — re-sent the same corrupted history and 400'd again. The
error-bubble "Repair history" button was also gated solely on
`hasOrphanedToolCalls(state.history)`, so it could stay hidden for a mismatch the
persisted-history detector missed.

Decision — make repair fire in the send path rather than adding a new mechanism:

- **Auto-fix on every send/retry**: call `persistToolHistoryRepair()` once at the
  top of `runTurnWithStallRetry`, the single choke point shared by sendMessage,
  retryFailedTurn, resumeFromNotice, and plan mode. It's a no-op on clean
  history, so the cost is negligible and Retry/Keep-going now self-heal.
- **Reliable manual affordance**: added a pure `isToolHistoryMismatchError(text)`
  signature matcher (Anthropic / OpenAI phrasings) so the error-bubble
  "🛠 Repair history" button appears for this failure class even when the
  persisted-history detector is falsely clean. Kept `/repair` and the repair
  button (repair-only) as the explicit manual path the user asked for; updated
  the Retry tooltip to say it auto-repairs first.

Chose not to unify the per-provider request sanitizers (anthropic
`sanitizeToolUse` vs the shared `repairToolHistory`) in this change — the
send-path repair fixes the common orphaned-tool_use case for all providers, and a
deeper sanitizer refactor is a larger, riskier change better tracked separately.

Verified: unit tier green (added 5 `isToolHistoryMismatchError` cases incl. the
exact reported 400 string); new panel-level e2e seeds the exact orphaned-tool_use
shape and proves `/repair` persists a synthetic error-marked `tool_result` and
the chat becomes sendable; a clean chat reports "nothing to fix". Manually
reproduced in the browser and screenshotted the repaired state + confirmation
toast. Re-ran ai-slash-commands / ai-transient-retry / ai-autoresume — no
regressions.
