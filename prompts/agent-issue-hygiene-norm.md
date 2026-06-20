---
date: 2026-06-14
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - CLAUDE.md
  - .claude/settings.json
---

## Human

Worried that valuable work and discoveries made ad-hoc in a chat session get
lost — wanted the harness to ensure (a) discoveries become tracked issues and
(b) a merged PR can't quietly leave its source issue partially implemented.
Asked whether/how to update the agent instructions. Chose, via AskUserQuestion:
"boundary hygiene" scope (not issue-first-for-everything) + "instruction +
Stop-hook nudge" enforcement.

## Assistant

Pushed back on the literal "an issue before all work" framing — that friction
would kill the fast chat-driven flow and train everyone to route around it. The
real goal is "no work or discovery lost at a boundary," so I encoded boundary
hygiene rather than issue-first.

- **CLAUDE.md** — new "Issue hygiene" section (before Retros): you need NO issue
  to start ad-hoc work, but at every completion boundary (PR opened/merged, task
  done) you must (1) file discoveries as issues before moving on, (2) never let a
  partial implementation close its source issue silently — keep it open with a
  remaining-work checklist or file a follow-up, (3) do an explicit close-out
  reconciliation in chat (source issue done? deferred → tracked? discovered →
  filed?). The test: "could the next session pick up everything important
  without reading this chat?"
- **Enforcement** — folded the reconciliation reminder into the EXISTING retro
  `Stop` hook reason (one nudge at the dirty-tree boundary) rather than adding a
  second always-on Stop hook (avoids Stop-noise). Honest limit, noted to the
  user: a hook can't semantically verify "issue fully implemented" — it can only
  nudge; the instruction + work-reviewer carry the judgment. Verified the hook
  still emits on a dirty tree and exits silently when `stop_hook_active`.
