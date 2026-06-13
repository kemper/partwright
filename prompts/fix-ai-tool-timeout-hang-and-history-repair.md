---
date: 2026-06-13
branch: claude/affectionate-archimedes-scwe5u
files_changed:
  - src/ai/agentWorker.ts
  - src/ai/agentWorkerClient.ts
  - src/ai/chatLoop.ts
  - src/ai/gemini.ts
  - src/ai/historyRepair.ts
  - src/ai/slashCommands.ts
  - src/config/appConfig.ts
  - src/ui/aiPanel.ts
  - src/ui/advancedSettingsModal.tsx
  - tests/unit/historyRepair.test.ts
  - CLAUDE.md
---

## Human

An AI session appeared to hang on a `runAndSave` tool call; the diagnostic log
showed "Tool call \"runAndSave\" (tc-10) timed out after 60s". The Stop button
in the AI pane did nothing — only a page refresh stopped it, and there was no
"Rendering…" / Cancel affordance. After refreshing, every turn then failed with
an unrecoverable provider 400 ("tool_use ids were found without tool_result
blocks"), and rewinding the conversation didn't escape it. Asked for a thorough
investigation and a plan covering the multiple improvements. Chosen scope: all
four fix areas; raise the default tool-call timeout to 300s; expose history
repair as an explicit button only (no silent on-load mutation).

## Assistant

Four interlocking failures, fixed together:

1. **Tool timeout hard-hung the whole panel.** The Worker-side tool-call
   timeout rejected, and that rejection propagated uncaught through
   `timedExecuteTool` → `executeAllWithRetry` → `runTurn`, so the agent Worker
   posted a fatal `error` and the panel's `await runTurn(...)` rejected with no
   cleanup — `state.inFlight` stayed true forever (Send disabled, Stop dead).
   Fix: `timedExecuteTool` now catches a thrown tool execution and returns an
   `isError` tool *result* so the loop survives and the model can react;
   `runTurnWithStallRetry` wraps `await runTurn(...)` in try/catch as a backstop
   so the panel can never be left wedged in-flight again.

2. **The timeout never cancelled the actual render** (it only abandoned the
   Worker's wait; the main-thread execution kept burning CPU and froze the
   page). The Worker now posts `cancel_tool` on timeout and the client calls
   `cancelCurrentExecution()`. Default timeout raised 60s → 300s (legit complex
   renders exceeded 60s); still user-adjustable in Advanced Settings.

3. **AI Stop couldn't interrupt an in-flight tool.** The abort signal is only
   checked between tool calls, and nothing cancelled the engine. `stopActiveTurn`
   now also calls `cancelCurrentExecution()`, so an in-flight render is killed,
   the tool returns an error result, and the between-calls signal check ends the
   turn. The AI-pane progress line gained a live elapsed counter on the `tool`
   phase ("🔧 running … Ns") so a long render is visibly cancellable via Stop.

4. **Orphaned `tool_use` → unrecoverable 400, and rewind couldn't escape it.**
   Added `src/ai/historyRepair.ts` — one shared `ChatMessage`-level repair that
   pairs every orphaned tool_use with a synthetic error tool_result (nothing is
   deleted; incomplete calls are marked failed). Wired as an explicit, user-only
   affordance: a `/repair` (alias `/fix`) slash command and a "🛠 Repair history"
   button on the Turn-failed bubble (shown only when an orphan exists) — never a
   silent on-load mutation, per the chosen scope. `rewindTurn` now runs the same
   repair after its cut so the post-rewind history is always sendable (it
   previously only cut at the last *typed* user message, leaving mid-history
   orphans). Closed the Gemini gap too: `buildGeminiContents` had no orphan
   sanitizer (unlike anthropic.ts / openai.ts), so it now repairs the history
   before emitting `functionResponse` parts.

Verified: typecheck, 1331 unit tests (incl. new `historyRepair.test.ts`),
madge acyclic, production build, and a throwaway Playwright spec that seeded an
orphaned history, confirmed `/repair` is discoverable, ran it, and asserted the
persisted history became pair-consistent.
