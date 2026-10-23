---
session: "01V7thZjELhuagRZSPvf2JQL"
timestamp: "2026-10-23T21:30:00Z"
---

## Human

Merged the workflow PR; post the old PRs' screenshots now.

## Assistant

## Key decisions

**Docs were wrong about cloud dispatch**: the GitHub MCP `actions_run_trigger`
call that #1079 documented for cloud sessions returns 403 ("Resource not
accessible by integration"), same as `gh`. So a cloud session cannot start the
workflow at all. Corrected CLAUDE.md, the script's message and the workflow
header: upload before opening the PR or pushing (the push posts the comment);
for a re-shoot with no push or a merged PR, the script prints the Actions →
Run workflow inputs for a person to use.

**Old PRs**: #1062 and #1063 got their comments from the push of a fresh
`main` merge (clean merges, preflight green), and their bodies' broken
sections now point to the comment. #1054 and #1060 are merged, so they need a
manual workflow run.

**Branch reuse pitfall**: opening #1080 on the same branch as merged #1079 made
the workflow post #1079's sample screenshots on a docs-only PR. Documented it
(re-upload, or delete the bot comment) rather than adding a time-based filter,
since screenshots are normally uploaded before the PR exists and any cut-off
heuristic (PR creation, first commit, merge base) misfires on some flow.
