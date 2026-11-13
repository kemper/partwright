---
date: 2026-11-13
branch: claude/pensive-gauss-jtt9qp
files_changed:
  - CLAUDE.md
  - retros/reports/2026-W46.md
  - retros/archive/2026-W46/
---

## Human

Scheduled weekly routine: run /retro-review — cluster retros/inbox/, apply
confident process diffs, write the ISO-week report, archive the entries, and
open a draft PR labelled ignore-for-release.

## Assistant

Ten entries, ten sessions. The dominant cluster (6 agents) was the AI turn-0
budget having ~no headroom; second, cross-PR invariant tests breaking main
after independently-green merges; third, stacked-PR retargeting not firing CI
(already partly covered by the W44 note).

Applied only edits that extend existing CLAUDE.md lines rather than adding new
rules: the stacked-PR note now says to retarget before the push, and the
turn-0 budget item now states the headroom reality and to re-run test:unit
after merging origin/main. Workflow triggers, merge queue, ai:budget headroom
output, and model:preview --crop/--piece went to the backlog because they are
tooling/CI changes outside the retro's direct-edit scope.
