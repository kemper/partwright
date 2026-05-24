---
session: "staging-gate-and-test-tiers"
timestamp: "2026-05-24T14:47:22Z"
model: claude
---

## Human

Implement the deployment-pipeline change and the e2e test refactor we discussed.
Move to a three-branch quality-gate: `main` is the integration branch and
deploys a pre-test preview; a GitHub Action gates `main → staging` on a green
build + test run so staging is always known-good; `production` is promoted by
hand. Also split a fast unit tier out of the Playwright suite and parallelize
the browser tests. Base the work on `main` (just synced from staging) and update
the agent files, README, and any other codebase instructions to match.

## Assistant

**Pipeline.** Replaced `sync-staging.yml` (which merged main→staging with no
test gate) with two workflows:

- `staging-gate.yml` — on push to main: `build-unit` (tsc + vite build +
  vitest) → `e2e` (3-way `--shard=i/3` matrix) → `promote` (fast-forward
  staging and push). Promote is reached only when build, unit, and every e2e
  shard pass, so a red gate parks staging on the last known-good commit.
  Serialized via a `concurrency` group so rapid pushes don't race the staging
  push.
- `pr-checks.yml` — on PRs into main: build + unit only (fast, pre-merge). The
  full e2e suite is deliberately the post-merge gate, keeping the main preview
  pre-test.

**Test tiers.** Added vitest (`vitest.config.ts`, node env, `tests/unit/**`).
Moved the one genuinely pure-logic spec (`tests/patch.spec.ts`, which imported
`src/ai/patch` and used no browser) to `tests/unit/patch.test.ts` — runs in
~1s instead of booting a browser + dev server. Pinned Playwright `testMatch`
to `**/*.spec.ts` so the unit tier stays out of the e2e run. Added
`test:unit` / `test` scripts.

**Parallelism decision.** First tried file-level parallelism (`workers > 1`).
A full run produced 7 unrelated single-test failures including a 30s timeout;
re-running those 7 specs serially passed all 48 of their tests — pure WASM/CPU
contention, since each test boots WASM in its own page. Reverted to
`workers: 1` (contention-free on any one machine) and get parallelism from CI
sharding instead, which cuts wall-clock ~3× without the flakes.

**Docs.** Rewrote the Deployment sections of CLAUDE.md (also AGENTS.md /
GEMINI.md via symlink) and README.md for the three-branch model, retargeted the
draft-PR flow and review/CI guidance from `origin/staging` to `origin/main`,
and documented the two test tiers. `public/ai.md` had no branch/deploy
references, so it was left unchanged.
