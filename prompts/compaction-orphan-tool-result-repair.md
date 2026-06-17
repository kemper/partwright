---
date: 2026-06-17
branch: claude/dreamy-mccarthy-ksv7wa
files_changed:
  - src/ai/historyRepair.ts
  - src/ui/aiPanel.ts
  - src/ai/anthropic.ts
  - src/ai/openai.ts
  - src/ai/local.ts
  - tests/unit/historyRepair.test.ts
  - tests/ai-providers.spec.ts
---

## Human

After using the in-app `/compact` feature on a long session, the very next
turn hit a provider 400 about a tool_call_id that didn't exist. Two
hypotheses: (1) compaction isn't clearing out tool-call info, leaving a
dangling reference; (2) the existing "repair corrupted tool history" recovery
feature doesn't apply to this error category. Investigate, fix, open a PR.

## Assistant

Root cause: the whole tool-history-repair stack only ever handled ONE
direction — an orphaned tool_**use** (assistant `tool_calls` with no matching
result → inject a synthetic error result). The compaction failure is the
mirror image: an orphaned tool_**result** — a kept `user.toolResults` entry
whose originating `tool_use` was in the dropped/summarized slice. Every hosted
provider 400s on a tool_result answering a tool_use it can't see ("unexpected
`tool_use_id`" / "tool message must respond to a preceding tool_calls"). This
explained both of the user's hypotheses at once:

- `repairToolHistory`/`hasOrphanedToolCalls` only detected orphan tool_uses, so
  the "🛠 Repair history" button never appeared for this case AND the repair
  wouldn't have fixed it (hypothesis 2), and
- compaction's `isOrphanToolResultHead` walk only guards the *head* of the kept
  window, so a severed tool round elsewhere left a dangling result persisted
  (hypothesis 1).

Fix, defense-in-depth across all five providers:

1. **`historyRepair.ts`** — `repairToolHistory` now also strips orphaned
   tool_results (gather every known tool_use id; drop result blocks outside the
   set; delete a carrier emptied by the strip via a new `toDelete` field).
   This single canonical fix lights up the repair button (`hasOrphanedToolCalls`
   is bidirectional now), powers `/repair`, the rewind guard, **and Gemini**
   (which already routes through it).
2. **`aiPanel.ts`** — extracted the rewind's inline repair into
   `persistToolHistoryRepair()` and called it from BOTH compaction apply paths
   (auto + manual) right after the drop+summary writes, so the persisted
   post-compaction history can never carry a dangling reference (hypothesis 1).
3. **Provider request builders** as a last line of defense (so the 400 never
   fires even on a stale pre-fix history): `anthropic.ts` `stripOrphanToolResults`
   in `buildApiMessages`; `openai.ts` orphan-output/orphan-tool-message strips in
   both `sanitizeResponsesToolCalls` and `sanitizeChatToolMessages` (covers
   `custom.ts`, which reuses them); `local.ts` now routes history through
   `repairToolHistory` like Gemini.

Verified: 1452 unit tests green (4 new orphan-tool_result cases in
`historyRepair.test.ts`); 3 new browser e2e tests in `ai-providers.spec.ts`
prove the orphaned tool_result is stripped from the real Anthropic / OpenAI
Responses / OpenAI Chat request payloads; `tsc --noEmit` clean; `lint:deps`
acyclic.
