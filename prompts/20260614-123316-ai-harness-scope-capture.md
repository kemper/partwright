---
session: "67mw1e"
timestamp: "2026-06-14T12:33:16Z"
model: claude-opus-4-8
areas: [agents, pr-flow, git-workflow]
---

## Human

Stepping back to analyze the overall AI harness quality. Core pain: dynamic
sessions fan out into 3–4 intended deliverables, but only the first becomes a
merged PR and the rest — which lived only in chat — evaporate at session end.
Already have a weekly issue-cleanup routine and a weekly retro routine. Wants
the harness to better capture well-defined work, have agents define work in
issues, and have a later reconciliation pass discover incomplete work and
propagate it into future issues — without becoming overly granular about issue
creation.

After the analysis, asked to implement four of the recommendations in one PR:
(1) a PR-body scope-manifest convention, (2) one tracking issue per
multi-deliverable session plus a `/scope` skill, (3) a Stop-hook fix so it also
fires after a clean commit-and-push, (4) an `/issue-reconcile` skill — all in
the same PR.

## Assistant

## Key decisions

**Diagnosis that shaped the design**: the harness captures *outcomes* richly
(prompt logs, retros, the close-out nudge) but captures *plans* nowhere — the
only copy of a multi-deliverable plan lives in the agent's volatile working
memory and dies at compaction/session-end. So the fix is a front-half plan-
capture layer plus making the existing boundary checks compare against it. The
prior issue-hygiene PR (#655) assumed a *source issue exists* to reconcile
against, which is exactly absent in the ad-hoc fan-out case — that's the hole
these changes close.

**One tracking issue per session, not per task**: the user explicitly does not
want fine-grained issue creation. Chose a single `[tracking]` umbrella issue per
multi-deliverable session (checklist of deliverables) over an issue-per-item
scheme. Keeps granularity at the session level while giving the reconciler a
concrete anchor.

**Scope manifest lives in the PR body**: the PR is the artifact the human is
looking at *at the moment of loss* (merge). Putting a "Part X of N" sibling
checklist there makes leftovers visible exactly then, and greppable by the
weekly reconciler — near-zero friction, rides on existing conventions.

**Stop-hook trigger broadened to `dirty OR ahead-of-origin/main`**: the
canonical loss case is commit→push→PR-open with a *clean* tree, which the old
`git status --porcelain`-only guard skipped entirely. Added
`git rev-list --count origin/main..HEAD` with `|| echo 0` so it degrades safely
to the old dirty-only behavior when `origin/main` doesn't resolve. Also rewrote
the reason text to point at `/scope` and the manifest so the nudge has a
baseline, not just a vague reminder.

**`/issue-reconcile` is additive-by-default**: it files/reopens/comments freely
(non-destructive) but only *closes* the unambiguous (all boxes ticked); anything
needing judgment is listed as "candidates to close" for the human. Mirrors the
retro-review human-gate philosophy and respects the irreversible-action
discipline. Codifying it as a checked-in skill (vs. the current uncommitted
scheduled-trigger prompt) was itself the point — the weekly cleanup was an
instance of the same "work that lives only in a prompt" failure mode.

**Scope of this PR**: docs/process + harness config only — no app code. The
deferred recommendation (closing/converting the ~25 stale April founding-epic
issues) was left out by design as independent housekeeping.
