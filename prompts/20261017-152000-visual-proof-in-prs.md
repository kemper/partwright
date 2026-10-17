---
session: "019jZz"
timestamp: "2026-10-17T15:20:00Z"
---

## Human

Update the agent instructions so that on any change with a visual change, the
agent attaches visual proof to the PR as well as sharing it in the chat. This is
for agents that build Partwright.

## Assistant

## Key decisions

**Codify the pattern PR #1021 already used** rather than invent a new one:
commit screenshots under `pr-assets/`, link them from the PR body by
commit-SHA-pinned `blob/<sha>/…?raw=true` URLs, then delete them in the next
commit so `main`'s tree never carries them. No external image host or GitHub
upload API is needed, and since the repo merges with merge commits the pinned
commit stays reachable after merge.

**Scope and gate.** "Visual" = anything that changes rendered pixels or visible
UI; pure-logic/test/docs changes are exempt. Changed behavior needs a
before/after pair. A `## Visual proof` section that matches the current head is
now part of the mark-ready gate in "After Opening a PR".

**Guard exemption.** The promptlog guard now ignores `pr-assets/` so the
screenshot commit doesn't force `--no-verify` (deletions were already exempt via
`--diff-filter=ACM`). The `work-reviewer` agent gets a reminder line — it can't
read the PR body, so it reminds rather than flags.

## Human

That's kind of messy — can't we use the gh CLI to attach assets? Can you update
gh? (I can update the image bake script to ship a newer one.)

## Assistant

**gh `--attach` exists (gh ≥ 2.99, Sept 2026) but can't run in cloud sessions.**
Installed 2.99.0 in the container to check: `gh pr/issue comment --attach` first
resolves the issue/PR over GraphQL, and the cloud session proxy 403s all GraphQL
(REST works). So a newer gh in the image helps local sessions only. The
instructions now prefer `gh --attach` and fall back to the SHA-pinned approach.

**Hide the fallback's mess behind one command.** `npm run pr:screenshots -- <png>…`
(`scripts/pr-screenshots.sh`) does the add-commit / delete-commit dance and prints
ready-to-paste Markdown links, so the CLAUDE.md recipe is two bullets instead of
a four-step procedure.
