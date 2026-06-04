# Retro

Capture a short, engineer-minded retro when you finish a meaningful task (a feature, a fix, a non-trivial chunk of work — typically one PR). This is **not** an incident report. The goal is to make the *next* agent faster and more reliable, so think like a developer reflecting on their own toolchain: note what worked, what fought you, and — most importantly — what you wished existed.

A weekly facilitator (`/retro-review`) aggregates everyone's entries, so frequency across many agents becomes the vote count. Your job is just to drop one honest, specific entry into the inbox.

## When to write one

- After completing a task/PR worth reflecting on. One entry per task is the right grain.
- **Skip it if nothing was notable.** A thin, generic entry ("tests were slow") is worse than none — it adds noise the facilitator has to filter. Only write when you have something specific and actionable.
- Don't write one for trivial work (a typo fix, a one-line tweak).

## What to write — the 4 Ls

Use these four buckets. Be specific and concrete; cite files, commands, turn counts, or PRs where you can. Leave a bucket out if you have nothing real for it.

- **Liked / Worked** — what in the setup made this delivery smooth. This protects the good parts: it tells the reviewer what *not* to break when editing instructions.
- **Lacked** — what was missing, stale, or fought you, and roughly what it cost (turns wasted, dead ends, re-discovery). Stale or wrong instructions go here.
- **Learned** — something true about the codebase you discovered this session that **isn't written down anywhere**. These are candidates for `docs/`.
- **Longed for** — the script, hook, instruction, or tool that would have made this faster or more reliable, *even if it doesn't exist yet*. Ideate freely. This is the most valuable bucket — design the improvement, don't just file a complaint. ("I wish there were `npm run test:e2e:one <grep>` so I didn't rebuild the whole suite to check one spec.")

## How to write it

1. Create `retros/inbox/` if it doesn't exist.
2. Write a new file at `retros/inbox/{YYYYMMDD-HHmmss}-{slug}.md` (UTC timestamp, short lowercase slug summarizing the task).
3. Use this template (drop empty sections, keep the frontmatter):

```
---
date: "2026-06-02T14:32:08Z"
task: "feat: add light/dark mode toggle"
pr: 142            # PR number if there is one, else omit
areas: [ui, theming]   # tags the facilitator clusters on — see common tags below
cost: medium       # rough friction cost this session: low | medium | high
---

## Liked / Worked
- The `/smoke-test` checklist caught the routing regression before I pushed.

## Lacked
- Spent ~4 turns rediscovering WASM init timing; the 4000ms settle wait isn't
  obvious from CLAUDE.md. (cost: ~4 turns)

## Learned
- `switchTab()` in layout.ts and `getViewState()` in main.ts must stay in sync
  for any new URL param — not documented near either function.

## Longed for
- A `npm run test:e2e:one <grep>` shortcut. I rebuilt the whole suite twice to
  check a single spec.
```

**Common `areas` tags** (reuse these so clustering works; add new ones only when none fit): `testing`, `git-workflow`, `pr-flow`, `ci`, `context/onboarding`, `tooling`, `docs`, `ai-panel`, `providers`, `renderer`, `surface`, `import-export`, `ui`, `build`, `agents`.

## Discipline

- Entries are **append-only** — never edit or delete someone else's entry. The facilitator archives them after processing; it does not rewrite them.
- Commit the entry (it belongs in the repo so it survives the ephemeral container and shows up for review). A retro entry can ride along in the same PR as the work it reflects on, or its own small commit — either is fine.
- Honest and specific beats polished. The facilitator can synthesize; it can't invent the friction you actually hit.
