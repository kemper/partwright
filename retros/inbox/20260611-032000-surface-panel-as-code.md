---
date: "2026-06-11T03:20:00Z"
task: "feat: Surface panel applies whole-model textures as api.surface code (phase 4, PR #584)"
areas: [surface, ui, geometry-api, codegen, ci, verification]
cost: medium
---

## Liked / Worked
- **The panel's existing decoupling made parity free.** Because surfaceModal
  drives `partwright.*` instead of editor internals, the as-code path is just
  one new console method — the UI feature and the agent-facing API are the
  same code, so the CLAUDE.md parity loop closed by construction.
- **The work-reviewer caught two real corruption bugs pre-CI** (regex editing
  api.surface mentions inside strings/comments). Raw-text regex over source
  is never safe; the lexical-mask + index-mapped-edit pattern that fixed it is
  small (~60 lines) and now reusable prior art next to the voxel codegen.
- **Diagnosing "CI silently stopped running" via event types.** push-triggered
  workflows (CodeQL, Cloudflare) kept firing while pull_request ones didn't —
  that asymmetry is the signature of an unmergeable PR (GitHub can't build the
  merge ref). `git merge-tree` confirmed conflicts in seconds.

## Lacked
- **A grep step for UI-string renames.** Renaming the panel's 'Apply' button
  broke two specs in two separate CI rounds (surface-voronoi on my branch,
  then surface-engrave arriving via the main merge). A rename of any
  user-visible string the e2e suite clicks should start with
  `grep -rn "<old label>" tests/` — and again after every merge from main.
- **No signal when a PR becomes unmergeable.** Webhooks don't deliver
  merge-conflict transitions, so two pushes produced no pr-checks runs before
  I noticed the pattern. A periodic mergeability probe in the PR-watch loop
  (the docs do hint at this) would have caught it on the first push.

## Learned
- **A conflicted PR silently skips all pull_request-event workflows** while
  push/event-driven ones still run — check mergeability before suspecting
  dropped webhooks (one genuinely dropped synchronize event also occurred;
  an empty `--allow-empty` commit retriggers cleanly).
- **Concurrent feature work converges on the same bugs:** main's engrave PR
  independently fixed the same regionless-tab `regionBlocked()` dead-lock my
  branch fixed. The merge resolution kept one implementation (the set) and
  folded engrave into it.

## Longed for
- An **ast-grep or unit check tying user-visible button labels to test
  selectors** — e.g. a lint that every `getByRole('button', { name: … })`
  string in tests/ exists in src/. Two CI round-trips for a label rename is
  exactly the class of drift a 20-line script kills.
