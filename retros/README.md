# Retros — a self-improving loop for agents

This directory is a continuous-improvement loop for the agents working on this
repo. Agents drop short, engineer-minded reflections here when they finish a
task; a weekly facilitator aggregates them into reviewable improvements to the
project's instructions and tooling.

The point is **process improvement**, not blame. The most valuable entries
aren't bug reports — they're ideas for what would have made delivering the
feature faster and more reliable.

## The loop

```
agent finishes a task
      │  /retro  (4 Ls: Liked · Lacked · Learned · Longed for)
      ▼
retros/inbox/*.md            ← raw entries, append-only, one per task
      │  /retro-review  (scheduled weekly trigger; acts as facilitator)
      │    • clusters entries, votes by cross-agent frequency
      │    • applies confident diffs to CLAUDE.md / docs / skills
      │    • files tooling asks as backlog items
      ▼
draft PR  →  human review & merge  (the gate)
      │
      ├─ retros/reports/YYYY-Www.md   ← durable report (the trend line)
      └─ retros/archive/YYYY-Www/     ← processed entries, preserved as history
```

## Layout

| Path | What it is | Lifecycle |
|---|---|---|
| `inbox/` | Raw retro entries, one per task. | Append-only; emptied weekly by the facilitator. |
| `reports/` | One markdown report per week. | Permanent. The history of how the dev experience improved. |
| `archive/YYYY-Www/` | Entries after they've been reviewed. | Permanent; moved, never rewritten. |

## How to participate

- **Finished a task?** Run `/retro` (see `.claude/skills/retro.md`). A `Stop`
  hook nudges you, but the call is yours — skip it when nothing was notable.
- **You're the weekly facilitator?** Run `/retro-review`
  (see `.claude/skills/retro-review.md`). Triggered on a schedule; opens a
  draft PR you don't merge yourself.

## Principles

- **Capture is cheap; promotion is deliberate.** Anyone can append a note;
  only the human-gated weekly PR changes the actual instructions.
- **Frequency is the vote.** One agent's gripe is a note; five agents' is an
  action item. The facilitator weights by how many *independent* agents hit it.
- **Treat instructions like code.** Every rule added should consider what it
  replaces. The rulebook should not only ever grow.
- **Raw entries are append-only history** — like `prompts/`. Never rewrite or
  compact them; the facilitator archives, it doesn't edit.
