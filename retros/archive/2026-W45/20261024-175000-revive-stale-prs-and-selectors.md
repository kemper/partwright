---
date: "2026-10-24T17:50:00Z"
task: "issue triage, revive #1004/#1018, feat: selectors for sculpt/deform/scatter"
areas: [git-workflow, pr-flow, agents, tooling]
cost: high
---

## Liked / Worked
- Splitting the backlog audit across two read-only subagents (founding epics vs
  recent tooling issues) returned verified tables (file:line, commit sha) fast.
  About 30 closes and 15 rescopes were applied with evidence comments, with no
  wrong closes.
- `npm run --silent model:preview -- <file> --json` was the right instrument for
  the selector work. Per-step bisection (transform / twist / scatter alone) made
  a combined-only failure obvious in three runs.
- `npm run pr:screenshots` before the push, then the workflow posts the Visual
  proof comment: worked exactly as documented from a cloud session.

## Lacked
- **Finished PRs silently stranded.** #1004 (3k lines, part editing) sat
  unmerged for two weeks while #1003's comment said "implemented". Main then
  grew parallel versions of the same ideas (`withinPart`, rail hide/delete).
  Reviving it was a reconciliation, not a merge, and took most of the session
  (56 conflict hunks, about 100 turns).
- Git silently applied #1004's deletion of `src/color/labels.ts` (main hadn't
  modified it), and main's Paint panel still imported it. Only `tsc`'s unused-import
  error led back to it. (cost: ~3 turns)
- The auto-mode classifier blocked a subagent from doing the approved GitHub
  issue writes ("External System Writes"), but allowed the same calls from the
  main session. Delegating outward writes is a dead end; do them inline.

## Learned
- `Manifold.warp` hands the callback the kernel's **double** positions, while
  `getMesh()` exports **Float32**. Keying a per-vertex lookup on a decimal grid
  (`round(x*1e5)`) splits vertices whose double and float straddle a grid line.
  Key on `Math.fround(x)` instead (src/geometry/selector.ts `weightLookup`). The
  symptom was tiny negative-volume components after a later boolean.
- `apiParity.test.ts`'s fixed scan window (80 KB, then 400 KB) keeps going stale
  as `partwrightAPI` grows; it now scans to the `help(` member.

## Longed for
- A **stale-PR alarm**: a weekly job (or `/issue-reconcile` step) that flags any
  open, green-at-some-point PR untouched for 7+ days whose tracking issue reads
  as done, *before* main drifts into a parallel implementation. #557, #870,
  #908, #1004 and #1018 all fit this pattern.
- `git merge` that reports "deleted on one side, still imported on the other"
  in the merge summary (a post-merge `tsc` hook in the merge flow would do).
