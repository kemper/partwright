---
date: 2026-11-24
branch: claude/pensive-gauss-voc0xq
files_changed:
  - CLAUDE.md
  - retros/reports/2026-W48.md
  - retros/archive/2026-W48/
---

## Human

Scheduled weekly routine: run /retro-review — cluster retros/inbox/, apply
confident process diffs, write the ISO-week report, archive entries, open a
draft PR labelled ignore-for-release.

## Assistant

- 14 entries. The top cluster (5 agents) was the AI context budget having no
  headroom. `ai:budget` already lists the largest sections, so the fix was a
  process line (start in a subdoc), not a new tool. Changing the ceilings is a
  human decision, so it went to the backlog.
- Cross-PR invariant breakage (2 agents) and the stacked-PR retarget trap
  (3 agents, adds to the W44 note) were folded into existing CLAUDE.md
  bullets instead of new sections, to keep the file from growing.
- Tooling asks (helpers, perf harness, model:preview flags, merge queue) are
  backlog only, per the skill.
