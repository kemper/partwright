---
date: 2026-06-23
task: weekly retro review 2026-W26
pr: (draft — opened after this commit)
---

## Human

Run the weekly `/retro-review` skill: cluster the 82 entries in `retros/inbox/`, apply confident process changes to `CLAUDE.md`/`docs/`/`.claude/skills/`, file tooling asks as backlog items, write a durable report to `retros/reports/2026-W26.md`, archive the inbox, open a draft PR, and send a Telegram summary.

## Assistant

Processed 82 inbox entries (2026-06-11 through 2026-06-21) across ~55 distinct sessions. Top 15 clusters identified by cross-session frequency.

**Key decisions:**

- Edits targeted existing callouts/bullets rather than adding new sections — the goal is to replace stale guidance, not append. All 6 edits extend paragraphs already in the relevant sections.
- Several high-vote themes (investigate-before-implementing, work-reviewer gate, prototype-first) were already in CLAUDE.md and correctly positioned. No redundant re-documentation.
- `bounds()` AABB warning and `smin`/genus diagnostic were the highest-value new content — multiple sessions re-derived these from scratch and the insights are non-obvious.
- Nested `claude -p` Stop-hook trap was documented as a standalone bullet because it's a sharp edge that has burned 5+ independent sessions and is easy to prevent with one sentence.
- 8 backlog items filed for tooling/structural changes that are out of scope for direct CLAUDE.md edits (lint rules, agent definition changes, architectural refactors).

**Why `bounds()` and `smin` warranted direct documentation:**
Both are counterintuitive in ways that defeat "just measure carefully" advice. `bounds()` looks like a precise measurement but is documented as a conservative AABB. `smin` looks like a smoother `min` but is non-Lipschitz and accumulates phantom topology — the only observable symptom (genus rising with resolution) is the opposite of what "not enough detail" would look like.
