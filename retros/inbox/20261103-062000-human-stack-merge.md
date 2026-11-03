---
date: "2026-11-03T06:20:00Z"
task: "feat: land the api.human PR stack (#1153 → #1169) on main"
pr: 1169
areas: [tooling, ci, ai-panel]
cost: medium
---

## Liked / Worked
- The stack was one straight chain, so merging main into the top branch only
  (one conflict pass for seven PRs) was enough to land all of it.
- The AI budget and Gemini-schema unit tests named the exact problems
  (unplaced tool, free-form object param, 2,743 chars over) before any CI run.

## Lacked
- Retargeting a stacked PR's base to `main` does not start PR-checks: the
  workflow runs on `opened` / `synchronize` / `reopened` only, so the PR sat
  with no e2e signal until the next real push. (cost: 1 wait cycle)
- The full tool-schema budget had 150 characters of room on main, so landing
  one feature tool meant trimming three unrelated tools. Now at 1 character
  (#1234). (cost: 6 measure-and-trim rounds)
- `vitest` hides `console.log` from passing tests; measuring a size took
  `--silent=false --disableConsoleIntercept`. (cost: 2 turns)

## Learned
- Retarget a stacked PR to `main` BEFORE the push that should run CI, or the
  push lands while the base is still a feature branch and nothing runs.

## Longed for
- `npm run ai:budget` printing the full-list total and headroom against each
  ceiling, so sizing a new tool is one command.
- A `pr-checks` trigger on `edited` when the base changes to `main`.
