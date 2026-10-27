---
name: release
description: "Cut a Partwright production release end to end: bump package.json + add the What's New entry through main, wait for the gate to advance staging, open and merge the staging → production promotion PR, then verify the live deploy and the vX.Y.Z tag. Use for the weekly deploy routine or whenever asked to deploy, release, or promote to prod."
---

# Release (staging → production)

Ships everything that has passed the main → staging gate to
`www.partwrightstudio.com`, tagged as a semver GitHub Release. Read CLAUDE.md
§ Deployment for the pipeline itself. This skill is the procedure, plus the
traps the pipeline sets for an agent.

**Invariant: `production` never carries content `main` lacks.** Version bumps,
changelog and help edits go into `main` through a normal PR *first*. The
promotion PR only moves `staging` forward and introduces nothing of its own.
(The old flow committed docs onto a release branch, which is exactly the
drift that `production-promotion-guard` exists to reject.)

Budget about 45 minutes. Most of it is waiting on CI (~8 min for the bump PR's
e2e shards, ~10 min for the gate). Don't foreground-`sleep`. Wait with the
GitHub tools (`actions_list` → `list_workflow_runs`, `pull_request_read` →
`get_check_runs`), or a `run_in_background` Bash poll of `git ls-remote`.

## 0. Preflight: is there anything to ship?

```bash
git fetch origin main staging production --tags
git rev-list --count origin/production..origin/staging   # 0 → nothing to release; stop
git rev-list --count origin/main..origin/staging         # must be 0 (staging ⊆ main)
git show origin/production:package.json | grep '"version"'
```

- Count 0 → report "nothing to release" and stop. No empty releases.
- Check the latest `Gate main → staging` run (`staging-gate.yml`). If it's red,
  `staging` is parked on the last good commit, which is fine to ship, but say
  in the report that `main` is ahead and failing.
- List what ships: the first-parent merges in
  `git log --first-parent origin/production..origin/staging`. Each merge body's
  first line is the PR title.
- Check that production is up right now (`curl -sI https://www.partwrightstudio.com/editor`
  → 200), so you can tell later whether a problem came from this release.

## 1. Pick the version

Use the PR titles since the last tag, per CLAUDE.md's semver rules:

| Shipping | Bump |
|---|---|
| any `feat!:` / `BREAKING CHANGE` | **major**. **Stop and ask a human.** A major needs the `/vN/` pinned-mount work and a user migration, so never cut one unattended. |
| any `feat:` | minor |
| only `fix:` / `chore:` / `docs:` / `refactor:` / `test:` | patch |

If `origin/main`'s `package.json` already has a version above production's
(someone bumped it already), skip step 2 and use that version.

## 2. Bump PR into `main`

Branch from `origin/main` (your designated branch if the session has one):

1. `package.json` → the new `version`. `package-lock.json` pins `0.0.0` and is
   **not** bumped.
2. `src/content/data/whatsNew.ts` → prepend an entry to `WHATS_NEW_WEEKS`.
   Copy the shape of the previous release's entry: `range` (release date),
   `headline: 'Partwright X.Y — <theme>'`, a `Releases` group whose one item
   summarizes the release and says it's backward-compatible, then themed
   groups. Cover **user-facing** changes only, in plain language, leading with
   fixes users were hitting. Skip harness, eval, retro, and catalog-tooling
   work. Verify every feature name against the code before you claim it.
3. `src/content/data/help.ts`: edit only if shipped behavior made the help page
   wrong. Feature PRs usually update it themselves; diff it first.
4. Stage a prompt log under `prompts/` in its own `git add` step (see
   `/promptlog`), or the commit hook blocks the commit.
5. `npm ci` if `node_modules` is missing, then `npm run typecheck && npm run test:unit`.
6. Commit `docs: changelog for Partwright X.Y + version bump`, push, open a
   **draft** PR into `main` labelled `documentation`, with a scope manifest
   ("Part 1 of 2 … promotion PR").
7. Drive it green, per CLAUDE.md § After Opening a PR. **You can't re-run CI
   jobs** (403). A red e2e shard is fixed in code or reported, never re-run
   or skipped. A test that fails only because a hint, a shuffle, or a timer
   came out a certain way is a flaky test: make it deterministic in this PR
   (see `tests/editor-hints.spec.ts`).
8. Once green: mark it ready, then merge with `merge_method: merge` and
   `expectedHeadSha` = the head you verified.

## 3. Wait for the gate to advance `staging`

The merge triggers `Gate main → staging` (build + unit + 8 e2e shards, then a
`promote` job that fast-forwards `staging`). Wait until `staging`'s head is
your merge commit and it carries the new version:

```bash
git ls-remote origin refs/heads/staging        # == the bump PR's merge sha
git fetch origin staging && git show origin/staging:package.json | grep '"version"'
```

Gate red → `staging` doesn't move. Treat it as a CI failure on `main`: fix it
through another PR into `main`, or stop and report. Never point the release at
an older `staging`.

## 4. Promotion PR: `staging` → `production`

Open it (or reuse an open one) with head `staging` and base `production`.
Title `release: Partwright vX.Y.Z (staging → production)`, label
`ignore-for-release`. Body: a scope manifest pointing back at the bump PR, then
the user-facing summary grouped like the What's New entry, with links to the
shipped PRs. The PR follows `staging`'s head, so it picks up the bump on its own.

## 5. Pre-merge checks

Read `get_check_runs` on the PR head and go through every row:

| Check | Expected | If not |
|---|---|---|
| e2e / build-unit / gitleaks / Analyze / Cloudflare Pages | success | stop and report |
| `no-content-beyond-main` (`production-promotion-guard`) | **usually `action_required`**: `staging` was pushed by `github-actions[bot]`, and GitHub holds runs a bot's push triggers. Verify by hand instead: `git rev-list --count origin/main..origin/staging` is 0 **and** `git diff --stat origin/main origin/staging` is empty (or `staging` is an ancestor of `main`). | any commit on `staging` that isn't on `main` → stop; that's the drift this rule exists to prevent |
| `CodeQL` | A large release diff can surface **known by-design** `Code injection` alerts on the sandbox's `new Function('api', …)` calls in `src/geometry/engines/{manifoldJs,replicad,voxel}.ts`, which run the user's model code. Those alone are expected. Get the list from `GET /repos/kemper/partwright/check-runs/<id>/annotations` (public, no auth needed). | **any** alert on another file or rule → stop and report it |

`mergeable_state: blocked` is normal: production's branch rules need a review
and the held guard. You can't approve your own PR.

## 6. Merge to production

Only if the person or routine that invoked you **explicitly** authorized
merging with bypass (for example "merge without waiting for requirements /
bypass rules") **and** every row in step 5 passed or matched its known
exception. Then merge with `merge_method: merge` and `expectedHeadSha` = the
`staging` sha you verified. Make the merge its own tool call, never batched with
other work. Without that authorization, stop here: the PR is ready, tell the
human what's left.

## 7. Verify the deploy

All of these must hold. Wait up to about 10 minutes:

1. `Tag release on production` (`release-tag.yml`) run on the merge commit: success.
2. `get_latest_release` → `vX.Y.Z`, auto-generated notes.
3. `Cloudflare Pages` check-run on the production merge commit: success
   (`GET /repos/kemper/partwright/commits/<sha>/check-runs`).
4. Live site serves the new build: `curl -s https://www.partwrightstudio.com/whats-new | grep 'Partwright X.Y'`.
   That entry exists only in this build, so it's the quickest proof. Also check
   `/editor` and `/v1/editor` return 200.

## 8. If production breaks after the deploy

- **Preferred:** a human uses Cloudflare Pages → `partwright` → Deployments →
  previous production deploy → **Rollback**. It's instant and leaves git alone.
  Notify immediately with the symptom and the last good deploy.
- **Unattended, and only if explicitly authorized to roll back:** open a PR
  into `production` that runs `git revert -m 1 <release merge sha>` and merge
  it (bypass). Say plainly that this is the one sanctioned exception to the
  pure-promotion rule. Then file a blocking issue: the next release must first
  revert that revert, or `staging`'s already-merged commits won't redeploy.
  Fix forward through `main`.

## 9. Report

Version, bump PR, promotion PR, release link, and the live check result. Also
list anything you bypassed or accepted (held guard, CodeQL exceptions), what
blocked you if you stopped, and anything shipped that still needs a human
look. Close or update any `[tracking]` issue the release completes.
