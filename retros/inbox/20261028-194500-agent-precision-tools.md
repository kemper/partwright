---
date: "2026-10-28T19:45:00Z"
task: "feat: zoomed/clipped renders, ray queries in model code, focus return for agent reads"
pr: 1198
areas: [agents, renderer, testing]
cost: medium
---

## Liked / Worked
- A brute-force comparison test for the new bounding-volume tree caught a
  real bug on its first run: a ray grazing a vertex exactly was pruned by
  the box test, which had no tolerance.
- The shell-with-a-peg e2e scene turned a visual claim ("clip sees past the
  geometry in front") into a numeric probe assertion, and it exposed that the
  zoom camera sat INSIDE the model around a small feature.
- The independent `work-reviewer` pass found the blocking issue: reads that
  return triangle ids followed by an untargeted paint on the wrong object
  after focus returned.

## Lacked
- No cheap way to read another object without switching to it. Every
  object-targeted read reloads the editor, which is why "focus return" needs
  stashes and generation guards. A headless "peek" path would remove the
  whole class of problems.
- `preserveCurrentEditsIfNeeded` reports objects dirty right after an API
  save, so reusing the rail-click save-on-switch for agent switches added
  duplicate versions. Only the e2e test showed it.

## Learned
- `buildViewCamera` with a frame used to dolly in to 2× the box size. For
  small features, zoom by narrowing the FOV from outside the mesh's bounding
  sphere.
- `ai.md` is now 17 chars under its 168,000-char budget. Put new console
  docs in subdocs (`manifold-api.md`, `visual-verification.md`) with a
  one-line pointer.

## Longed for
- A real per-object read API (mesh, labels, stats of a saved version without
  loading it). That would serve focus-free agent reads and the cross-object
  access in #1197.
