# Release

Create a production release from staging — discovers existing docs, drafts updates, and opens the staging → production PR.

## Prerequisites

- `staging` is known-good: the staging gate has passed and `staging.mainifold.pages.dev` looks right.
- Clean working tree (or on a fresh branch).

## Steps

### 1. Gather what changed

```bash
git fetch origin production staging
git log origin/production..origin/staging --oneline
```

Pull the corresponding PR titles from GitHub for human-readable summaries of each commit.

### 2. Discover existing user-facing docs

Search for:
- A changelog file (`CHANGELOG.md`, `public/changelog.md`, or similar)
- The `/help` route source (grep for where `HelpPage` or `/help` content is rendered)
- Any "what's new" section in `public/ai.md`

Read the current state of each to match format and voice.

### 3. Draft documentation updates

Based on commits/PRs since last release, write:
- A new changelog entry (date + bullet points). Group into Features, Bug Fixes, Improvements. Skip internal refactors/chores unless user-visible.
- Help page additions for any new features users need to know about.
- `public/ai.md` updates if any `window.partwright` API, tool schemas, or agent workflow changed.

Show the drafts to the user and incorporate feedback before committing.

### 4. Commit docs on a release branch

```bash
git checkout -b release/$(date +%Y-%m-%d) origin/staging
# write doc updates
git add <doc files>
git commit -m "docs: update changelog and help for $(date +%Y-%m-%d) release"
git push -u origin release/$(date +%Y-%m-%d)
```

### 5. Open the staging → production PR

Create a **draft** PR from the release branch into `production`. Title: `chore: release YYYY-MM-DD`. Body should include:
- Summary of what's in this release (the changelog entry)
- Link to `staging.mainifold.pages.dev` for final validation
- Confirmation that the staging gate passed

Label it `ignore-for-release`. Flag the PR to the user — production is protected and requires human review before merging.
