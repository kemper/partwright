---
date: "2026-10-17T16:30:00Z"
task: "feat: part tools usability — auto patches, presets, seed markers, lock/focus, smooth edges"
pr: 1033
areas: [ui, testing, agents, tooling]
cost: medium
---

## Liked / Worked
- The work-reviewer subagent caught a real design flaw: default smooth edges
  pulled crease-aligned boundaries off the crease and baked that into every
  accept. Its probe script reproduced it in 1 minute. It also found the Worker
  keeping an orphaned draft after a version switch, which I would not have
  found by clicking around.
- `npx vite-node` scripts against the real 460k-tri STL gave timing and
  correctness numbers (split counts, manifold status, ranking scores) without a
  browser. This changed two defaults: the preset score, and the 15° → 60° pin.

## Lacked
- Vite full-reloads the page when files change during a long Playwright run.
  Two scratch runs died with "Execution context was destroyed" because I edited
  docs or prompts mid-run. (cost: ~2 runs, ~10 min)
- I deleted `.scratch/` (the user's STL + seeds) before the review round. Then I
  had to dig the upload out of `/root/.claude/uploads/` to re-verify.
  (cost: ~2 turns)

## Learned
- `computeMeshFeatures` crease cost is concave-only. A boundary on a convex
  ridge (box edge) has ~0 crease, so any "is this boundary on a seam?" test
  must use the absolute dihedral.
- On sculpted scans, groove edges fold 30–60° per edge. A seam-pinning
  threshold below ~60° pins the very stair-steps you want smoothed.
- Mean boundary crease is a bad ranking score: merging always raises it. Use
  the F1 of groove coverage and fidelity.

## Longed for
- A "freeze the dev server" mode for Playwright (no HMR or full reload), e.g.
  `PW_NO_HMR=1` setting `server.hmr=false` and `server.watch=null` in
  `playwright.config.ts`. Then long scratch specs survive concurrent edits.
- A conventional "keep for the session" scratch dir (e.g. `.scratch/keep/`)
  that the cleanup step skips, so user-provided fixtures outlive the pre-commit
  scratch purge.
