---
session: "treoA1"
timestamp: "2026-06-03T03:21:00Z"
model: claude-opus-4-8
tools: [github-mcp]
---

## Human

Failure with main and the pipeline to staging. The staging gate's "Refresh
models catalog snapshot" step runs `node scripts/refreshModelsSnapshot.mjs`,
then commits the changed snapshot and `git push origin HEAD:main`. The push is
rejected:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
 ! [remote rejected] HEAD -> main (protected branch hook declined)
Process completed with exit code 1.
```

Please fix or resolve.

## Assistant

## Key decisions

**Root cause**: commit `99bcd8d` moved the catalog refresh out of the Vite
build (to stop idempotency-breaking build-time churn) into the staging gate's
`build-unit` job, where it committed the snapshot and pushed *directly to
`main`*. `main` is a protected branch that requires PRs, so the bot push is
rejected with GH006 — the gate has never been able to succeed when the
snapshot changed. The gate is also the *only* refresh mechanism now (the old
Vite `catalogSnapshot` plugin was removed), so the snapshot can't just be
dropped.

**Fix shape**: writes to `main` must go through a PR — that's the branch model
the repo deliberately set up (`main` PR-only, `staging` written only by the
gate, `production` by manual release PR). So:

1. **New `.github/workflows/refresh-models-catalog.yml`** — scheduled weekly
   (+ `workflow_dispatch`). Runs the refresh script, and if the snapshot
   changed, validates it with `npm run build` + `npm run test:unit`, then
   force-pushes a bot-owned `chore/refresh-models-catalog` branch and opens (or
   leaves updated) a PR into `main` via `gh`. Merging that PR triggers the
   existing main → staging gate, which promotes the fresh snapshot to staging.
   Chose the weekly cadence because the script's `release_date` filter uses a
   moving "last 365 days" window keyed on run date, so the snapshot drifts even
   when models.dev doesn't — daily would churn a PR for no real change.
   Validated build+unit *inside* this workflow because PRs opened with the
   default `GITHUB_TOKEN` don't trigger `pr-checks`.

2. **`staging-gate.yml`** — removed the broken refresh/commit/push step and the
   `promote-sha` job output that threaded the post-refresh SHA through; the
   promote step now fast-forwards staging to `$GITHUB_SHA` (the commit the run
   was triggered on) directly. The gate is back to its single job: build, test,
   promote the pushed commit.

3. Used only first-party tooling (`actions/*` + pre-installed `gh`), no
   third-party PR-creating actions, to keep the supply-chain surface unchanged.
   Dropped the non-existent `chore` label from `gh pr create` (verified via the
   labels API — only `ignore-for-release` exists) so the command can't fail.

4. Fixed now-stale comments in `scripts/refreshModelsSnapshot.mjs` and
   `src/ai/catalog.ts` that still claimed the snapshot is refreshed "at build
   start" via a Vite plugin.

Verified: both workflow YAMLs parse; `npm run test:unit` passes (582 tests).
The refresh script soft-fails gracefully here (sandbox network returns 403),
preserving the committed snapshot — the intended resilience.
