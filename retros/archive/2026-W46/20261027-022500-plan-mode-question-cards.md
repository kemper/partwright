---
date: "2026-10-27T02:25:00Z"
task: "fix: keep plan mode read-only + feat: question and plan cards for the AI chat"
pr: 1146
areas: [ai-panel, providers, pr-flow, agents]
cost: medium
---

## Liked / Worked
- The `work-reviewer` agent paid for itself twice. On PR 1 it found that the new
  offered-tools gate refused the pre-rename `listParts`/`changePart` names that
  `executeTool` still dispatches. On PR 2 it found that Gemini/local reuse tool-call
  ids across responses, which made a later question card show an earlier card's
  questions. No test or type check would have caught either.
- The stubbed-SSE e2e pattern (`page.route('https://api.anthropic.com/**')` +
  hand-built `content_block_*` events, as in `tests/ai-tool-confirm.spec.ts`) made a
  full UI flow test — questions → answers → plan → reload → Build — quick to write.

## Lacked
- PR-checks only runs on PRs into `main` (`branches: [main]` in
  `.github/workflows/pr-checks.yml`), so a PR stacked on another branch silently got
  no CI. I found out only from the check list. Retargeting to `main` doesn't
  re-trigger either; it waits for the next push. CLAUDE.md doesn't mention it.
  (cost: ~3 turns, plus a PR body rewrite)
- `docs/ai-internals.md` said two consecutive user turns 400 on Anthropic, while
  `finish` already produced exactly that sequence in production. It's unclear which
  is true per provider. I merged adjacent user turns for Gemini and local to be safe.

## Learned
- A hidden tool isn't a blocked tool: `executeAllWithRetry` ran any tool name the
  model emitted. Gates must be enforced at dispatch (now `offeredTools` in chatLoop).
- Gemini (`gemini_call_${n}`) and local (`tc_${n}`, `tool_${idx}`) number tool calls
  per response, so a tool-call id is only unique within its message. Key any per-call
  UI state by message id + call id.
- Deriving UI state from the transcript (the pending plan) means every message path
  that feeds the transcript must carry the marker: queued messages, image-only
  messages, and rewind/fast-forward all broke it in review.

## Longed for
- A note in CLAUDE.md's PR section: "stacked PRs get no PR-checks; target `main` and
  say in the body which PR merges first." Better still, `branches: [main, 'claude/**']`
  in pr-checks.yml.
- A small unit-level harness that drives `chatLoop.runTurn` with a scripted provider
  and an in-memory message store (no IndexedDB). Enforcement, turn-ending tools and
  auto-continue interplay could then be tested in the ~1 s tier instead of Playwright.
