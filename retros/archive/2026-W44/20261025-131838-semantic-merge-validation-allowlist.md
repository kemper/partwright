---
date: "2026-10-25T13:18:38Z"
task: "fix: accept the select surface scope in worker validation; add Cloudflare preview prune script"
pr: 1116
areas: [ci, testing, pr-flow, tooling]
cost: low
---

## Liked / Worked
- The staging-gate history made "is this mine?" a two-call answer: same test,
  same error on main's gate run at the PR's base commit, and green one merge
  earlier (8731ec7) pinpointed which merges collided.
- Writing the unit case first surfaced a second bug the e2e didn't: a
  `select` key smuggled inside surfaceOps `params` passed validation.

## Learned
- `src/geometry/workerMessageValidation.ts` duplicates allow-lists of every
  Worker-result payload shape (surface scope kinds, paint scope keys, …). Any
  PR that grows those shapes (e.g. a new `SurfaceScope` kind in
  `surfaceOpSpec.ts`) must update the validator too, or every run using the
  new shape silently yields no geometry. Two PRs (#1111, #1109) were each green
  alone and broke main together — nothing ties the spec to the validator.

## Longed for
- A unit test that drives each `SurfaceScope` kind (and other recorder output
  shapes) through `checkEngineWorkerMessage`, generated from the spec's
  discriminant union, so adding a kind without a validator branch fails
  `test:unit` in the PR that adds it rather than on main after merge.
- Merge-queue / "re-test on latest main before merge" for PRs that touch
  `src/geometry/` validation or recorder specs.
