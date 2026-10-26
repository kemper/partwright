---
session: "01V7thZjELhuagRZSPvf2JQL"
timestamp: "2026-10-23T21:15:00Z"
---

## Human

Fix the visual proof on the old PRs too, and make sure those PRs are ready to
merge without conflicts.

## Assistant

## Key decisions

**Session posting is not reliable**: re-posting the old PRs' screenshots with
`pr:screenshots` (which posted via `gh api` from the session) failed its own
render check on all four PRs, even for freshly uploaded, URL-safe images (one
of four passed on one PR). The cloud proxy's image-link defanging is a
security control with no stable rule from the outside, so working around it
from the session is the wrong approach.

**Post from a workflow instead**: `.github/workflows/pr-visual-proof.yml`
renders the newest `pr-assets` upload into one comment with GITHUB_TOKEN and
fails red unless GitHub renders every image. It runs on PR open/push and on
workflow_dispatch (with an optional `upload` stamp, for two PRs sharing a
branch). The script is now upload-only plus a dispatch attempt; where gh can't
dispatch (cloud), it prints the GitHub MCP `actions_run_trigger` call.
`--branch` added for acting on another branch's PR. Earlier uploads are now
only counted in the comment, not linked.

**Old PRs**: merged main into #1062 (two additive conflicts in tools.ts and the
help() table, kept both sides) and #1063 (clean), preflight green on both. The
four broken comments posted by the failed attempt were deleted; the repair
uploads are on pr-assets, to be posted by the workflow once it is on main.
