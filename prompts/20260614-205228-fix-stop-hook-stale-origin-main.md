---
session: "67mw1e"
timestamp: "2026-06-14T20:52:28Z"
model: claude-opus-4-8
areas: [agents, git-workflow]
---

## Human

Create PRs for the agreed follow-up tasks from the harness-scope work. Of the
four follow-ups, only #666 (the Stop-hook false positive) is a code change;
#659 is GitHub issue triage and the other two are scheduled-trigger config /
observational, so this PR addresses #666 only.

## Assistant

## Key decisions

**Root cause (#666)**: the Stop hook added in #658 gates on
`git rev-list --count origin/main..HEAD`, but `origin/main` is the *local*
remote-tracking ref. It isn't updated when a PR merges server-side, so after a
merge (before a local fetch) the branch's commits still count as "ahead" and the
hook nags about "unmerged commits" on an already-merged branch. Observed firing
twice after #658 itself merged.

**Fix chosen — best-effort `git fetch --quiet origin main` before the count**,
guarded with `|| true` so a fetch failure (offline) silently falls back to the
stale ref and the hook still behaves as before. Picked this over "leave it"
because the user explicitly wanted it fixed. The fetch is cheap in the primary
(remote-container) environment where `origin` is a local proxy.

**Why the fetch actually fixes it**: this repo merges PRs via **merge commits**
(not squash), so after the fetch the branch's commits are ancestors of the fresh
`origin/main` and `origin/main..HEAD` collapses to 0. Verified empirically: the
already-merged #658 branch reports `ahead=0` against freshly-fetched main.
(Noted in the PR that a squash-merge workflow would defeat this reachability
check and need a different signal — not applicable here.)

**Trade-off accepted**: one network round-trip per `Stop`. On a laptop with a
hung network this could briefly stall session-end; deemed acceptable versus the
recurring false nag, and `|| true` bounds the failure mode to "behaves like
before."
