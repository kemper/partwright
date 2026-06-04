---
date: 2026-06-04
branch: claude/sync-main-superset
files_changed:
  - .github/workflows/production-promotion-guard.yml
  - CLAUDE.md
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
  - public/ai.md
  - public/llms.txt
  - public/ai/gotchas.md
  - public/ai/colors.md
  - public/ai/annotations.md
---

## Human

Port anything missing from main back to main. The flow should be
main → staging → production, and there should never be commits ahead on staging
or production that are not on main. Is there a change to the agent instructions
or hooks to help ensure we never get out of sync again?

## Assistant

Diagnosis: `git diff origin/main origin/staging` is empty — staging never
drifts, because the staging gate only ever fast-forwards it from main. The one
drift vector is the **manual release PR into production**: the May 30 release
committed changelog/help edits (`17f7321`) directly onto the release branch, so
that content reached production but never main. A later content-data refactor on
main then branched over the orphaned edits and effectively dropped them.

Two-part fix:

1. **Port-back.** Cherry-picked the two doc commits (the restored May 30
   changelog entry, the new May 31–June 3 entry, the "Catalog & Ideas" help
   section, and the editor-lock doc corrections) onto a fresh main-based branch
   so main becomes the superset again.

2. **Prevent recurrence:**
   - `production-promotion-guard.yml` — a CI job on `pull_request:
     branches: [production]` that replays the PR head on top of `origin/main`
     index-only and fails if anything stays staged (i.e. the release introduces
     content main lacks). Conflicts with main also fail. This makes "release PRs
     must be pure promotions" mechanically enforced. It lives on main and flows
     down to production so future release PRs are gated by it.
   - `CLAUDE.md` — added the **"main is the superset"** invariant to the
     Deployment section: release PRs carry only commits already on main; all
     changelog/release-note edits go through a normal `docs:` PR into main
     first, never onto the release branch. Documents the guard and cites the
     May 2026 drift as the cautionary case.

Verified the guard logic locally: it passes a pure promotion (origin/staging,
which is content-identical to main) and flags a branch carrying unmerged doc
commits.
