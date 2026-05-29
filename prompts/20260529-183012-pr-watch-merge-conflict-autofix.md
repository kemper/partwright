---
session: "7c7fd5"
timestamp: "2026-05-29T18:30:12Z"
---

## Human

I have agents configured to watch PRs they've made but they don't auto-fix
merge conflicts. I'd like them to start doing that. Update the agent harness so
they do. The prompt/hint should note that they should understand and respect
recent work and ensure things work, vs. just resolving conflicts.

## Assistant

## Key decisions

**Where the "harness" lives.** The PR-watching agents read two instruction
surfaces: the platform's event-handling system prompt (not in this repo, not
editable here) and `CLAUDE.md` (checked in; `AGENTS.md` and `GEMINI.md` are
symlinks to it, so it conditions every agent runtime, including a watcher that
wakes on a PR event). Grepping the repo for `merge conflict` / `subscribe_pr_activity`
/ `auto-fix` / `babysit` returned only `CLAUDE.md`, confirming it's the single
repo-level lever. So the change went there — specifically the **After Opening a
PR** section, which already governs live PR tending (CI auto-fix, description
sync, mark-ready).

**Why a dedicated step, not a sub-clause of the CI step.** A PR can be
non-mergeable without any CI failure — base-branch advance is a distinct
trigger. It deserved its own first-class step (new step 4) rather than being
buried under "Follow CI and auto-fix what you can" (step 3). Merge-conflict
resolution and CI auto-fix are siblings — both are "the PR is in a bad state,
push a fix to the branch" — so step 4 sits right after step 3 and mirrors its
"stop and ask if large/ambiguous/risky" escape hatch.

**The two guardrails the user asked for, made structural.** Step 4 leads with
the mechanics (fetch/merge-or-rebase/resolve/push) but then states the bar is
"an integrated, working result — not just a clean merge," split into two
numbered sub-points: (1) *understand and respect the recent work* — read what
landed on `main`, reconcile *with* it, never drop someone else's merged work to
make your side apply cleanly (ties into the existing clobbering warning and the
"functionality dropped in a merge" review item); (2) *prove it still works* —
re-run build + unit, let PR-checks re-run e2e, redo manual/render verification,
because the merged result is new code to verify.

**Tied into the watch loop.** Added a clause to step 1 ("Watch the full suite")
so watching explicitly includes mergeability, not just the test shards — that's
where a watcher first reads about its watch duty, and it points forward to step 4.

**Numbering.** Inserting step 4 renumbered the old steps 4→5 and 5→6; fixed the
one cross-reference ("step 5 below" → "step 6 below") in the section intro. No
other step-number references exist in the file.

**Scope.** Docs-only change to `CLAUDE.md` (+ this log). Build/unit can't be
affected by a markdown edit (neither reads it); PR-checks runs the full suite on
the PR regardless. Committed under the `docs:` prefix.
