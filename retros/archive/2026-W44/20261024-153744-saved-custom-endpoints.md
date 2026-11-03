---
date: "2026-10-24T15:37:44Z"
task: "feat: saved custom endpoints and append-only cliproxyapi key setup"
pr: 1091
areas: [providers, ui, testing, agents]
cost: medium
---

## Liked / Worked
- The `work-reviewer` subagent caught two real blocking bugs I missed. One was an async Connect writing its results onto whichever endpoint was open after the await. The other was same-URL twin endpoints resolving to the wrong key. It also found a shell-injection path through a restored backup's config path. Running it before marking ready paid for itself.
- I unit-tested the generated shell/awk command by running it with `execFileSync` against sample configs. That turned "I think the append works" into proof, and later made the reviewer's edge cases (flow list, CRLF, header comment) cheap to add as regressions.

## Lacked
- The Playwright `Desktop Chrome` device spoofs a Windows UA, so OS-sniffing UI renders the Windows variant in every screenshot. It cost a confused screenshot round before I understood why. (cost: ~2 turns)

## Learned
- In a Preact component, any `await` followed by `persist(draft)` is a stale-target bug waiting to happen: the user can switch the open item during the await. Capture the id and write by id.
- Shell-command generators need a proper quoting policy ("only the exact known default gets double quotes"). A prefix check like `startsWith('$(brew --prefix)')` is an injection vector.

## Longed for
- A note in CLAUDE.md, or the Playwright config, about the spoofed Windows UA for anyone testing OS-specific UI.
