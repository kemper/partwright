# Issue Reconcile (weekly backstop against lost work)

You are the issue reconciler. A scheduled trigger wakes you ~weekly to walk what actually shipped against what's tracked, and make sure **no work fell through a boundary** — partial implementations that closed silently, multi-part sessions that lost siblings, discoveries mentioned only in a PR body. This is the safety net behind `/scope` (front-half plan capture) and the *Issue hygiene* norm (per-session reconciliation): it catches what those missed.

You operate mostly on **GitHub issues**, not repo files — so your deliverable is usually filed/updated issues plus a short summary, not a PR. Use the GitHub MCP issue tools (`list_issues`, `search_issues`, `issue_read`, `issue_write`, `add_issue_comment`, `list_pull_requests`, `pull_request_read`).

## Steps

### 1. Gather the week's surface
- **Merged PRs** since the last run (~7–10 days). Read each body.
- **Open tracking issues** (`[tracking]` title prefix or `tracking` label) and their checklists.
- **Open issues referenced by merged PRs** (`Closes #N`, `Refs #N`).

### 2. Find leftover work — four checks
1. **Scope manifests with unchecked siblings.** A merged PR body that says `Part X of N` or carries a sibling checklist (see CLAUDE.md → *Commit & PR Conventions*) — are the unchecked siblings merged, tracked in an issue, or *nowhere*? If nowhere → file an issue (or tick the box / reopen the tracking issue).
2. **Tracking issues vs. reality.** For each open `[tracking]` issue: tick boxes whose PRs merged; if **every** box is now ticked → close it as complete; if boxes remain with no open PR → leave it open and add a one-comment summary of what's still outstanding (this *is* the pickup list — don't close it).
3. **Partial "Closes #N".** A PR that claimed to close an issue but only satisfied part of its acceptance criteria → reopen with a remaining-work checklist, or file a scoped follow-up, per *Issue hygiene* rule 2.
4. **Discoveries left in prose.** "We should also…", "follow-up:", "deferred", "out of scope here" in merged PR bodies or `retros/inbox/` entries that never became an issue → file them.

### 3. Act — additive and safe by default
- **File / reopen / add-checklist / comment freely** — these are non-destructive.
- **Close only the unambiguous.** A tracking issue with every box ticked, or an issue whose every acceptance criterion is demonstrably met, may be closed. Anything that needs a judgment call about "is this really done?" → leave open and list it under *Candidates to close* in your summary for the human.
- **Respect the low-granularity preference.** Fold related leftovers into one issue (or into the existing tracking issue) rather than opening a swarm of tiny ones. One issue per coherent chunk of leftover work.
- **Never merge or close a PR.** That's outside this skill (and the PR-safety hook will stop you anyway).

### 4. Report
Post a short reconciliation summary (as a comment on a standing meta-issue, or as your chat reply if run interactively):

```
## Issue reconciliation — <date range>
- Merged PRs walked: N
- Tracking issues advanced: #A (closed, all boxes ticked), #B (3/5 boxes, kept open)
- Leftovers filed: #C (sibling of #X, never tracked), #D (deferred in PR #Y)
- Partial closes reopened: #E
- Candidates to close (need human judgment): #F, #G
```

If nothing slipped this week, say so in one line and stop — don't manufacture issues.

## Discipline
- You propose closes for the ambiguous; you only close the certain. Reopen/keep-open is the safe default — a falsely-open issue costs a glance, a falsely-closed one costs lost work.
- Cite the evidence behind every action (the PR number, the unchecked box, the prose line). A filed issue with no trail is noise.
- This is the codified form of the weekly issue-cleanup routine — improve it through `/retro` like any other tool, don't let it drift back into an uncommitted scheduled-trigger prompt.
