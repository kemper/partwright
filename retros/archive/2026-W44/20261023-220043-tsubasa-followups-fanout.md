---
date: "2026-10-23T22:00:43Z"
task: "Tsubasa follow-ups: #1049, #1050, #1055, #1056, #1059 + captured hair (tracking #1069)"
pr: 1081
areas: [agents, worktrees, ci, pr-workflow, figures, segmentation, photo-match]
cost: medium
---

## Liked / Worked
- Fanning five issues out to parallel worktree agents, each with a tight spec and a "report back" contract, shipped 7 PRs (#1070, #1071, #1074, #1076–#1078, #1081) in one session.
- A separate `work-reviewer` pass on every PR caught real blockers that the implementing agents' own tests missed:
  - smooth-paint cache dropping model colours;
  - a code-injection path through U+2028 in the character-spec header;
  - GrabCut inventing a subject on blank photos;
  - auto-absorb deleting user-named parts.
  Resuming the *same* implementing agent with the findings was cheap, because it kept its context.
- Text-only scores (photoMatch IoU, figure:smoke) let agents iterate on figures without image tokens.

## Lacked
- **Shared dev server across worktrees.** Playwright's `reuseExistingServer` on port 5173 meant parallel worktrees would silently test each other's code. Fixed by `E2E_PORT` (#1070), but only after spotting it.
- **Worktree agents branch from origin/main, not the caller's HEAD.** The E2E_PORT commit wasn't in the worktrees; each agent had to be told to cherry-pick it.
- **PR-checks only run on PRs into main.** A stacked PR based on another branch gets no CI. I retargeted the stacked PRs to main, with a "review only these commits" note.
- **PR bodies from cloud sessions keep only the first image URL;** later ones are mangled (#1075). Visual proof needs one montage image.
- 4 cores for 5 agents running figure builds and Playwright: everything was slow, and specs needed `--timeout 180000`.

## Learned
- In this session's MCP layer, GitHub PR bodies keep only the first external image intact. `raw.githubusercontent.com` `<img>` is fine for that one image.
- `JSON.stringify` doesn't escape U+2028/U+2029. Any user text that lands in a `//` comment of generated JS can break out.
- vite SSR servers started by CLI scripts create about 6.5k inotify watches each, unless `server.watch: null`.

## Longed for
- `npm run pr:screenshots -- --montage "label=a.png" …` that composites one captioned sheet and prints a single embed (#1075).
- An Agent-tool option to base an isolated worktree on a given ref (e.g. the caller's HEAD), not origin/main.
- PR-checks that also run on PRs whose base is another `claude/*` branch, so stacks get CI without retargeting.
- A per-worktree default `E2E_PORT`, derived from the worktree path, so nobody has to assign ports by hand.
