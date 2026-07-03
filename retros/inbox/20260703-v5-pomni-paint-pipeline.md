# 4-Ls — v5 Pomni paint pipeline (PR #870, rounds v1→v5)

**Liked**
- Ideation-before-implementation paid for itself in one find: a read-only
  geometry agent proved *no triangle-set approach can fix fan bleed* (the
  boundary runs through flat wedges), which redirected the whole round
  toward analytic fit+clip instead of another filter iteration — and a
  second agent found `probePixel`'s systematic-miss bug (stale camera
  matrixWorld) that four validation rounds had misread as "±10-20px aim
  error". Validation agents' feedback loops (structured `feedback.md`
  deliverables, ranked asks) turned each round into a concrete backlog.
- Parallel implementer subagents on pure leaf modules (regionFit,
  symmetry, faceGroups merge) while the primary held main.ts — zero merge
  conflicts, all three landed with tests.

**Lacked**
- Worktree provisioning cut agent worktrees from `main`, not the feature
  branch HEAD; all three implementers needed a mid-task correction
  message, and one worktree evaporated on resume (agent had to work in
  the shared checkout, new-files-only, no-git). If worktrees could pin a
  start ref this friction disappears.
- Per-feature paint QC didn't exist until the last round —
  `renderIsland` dropped paint colors, so validation agents rendered the
  whole 460k-tri kit and cropped, every iteration.

**Learned**
- When a validation agent invents a workaround (paint an analytic
  cylinder AT the feature instead of painting the region's triangles),
  that workaround IS the next tool — formalizing it (`fitRegionShape` +
  `paintRegionFitted`) took the technique from one lucky agent to the
  default path in the docs.
- "Miss" error messages that blame the caller ("re-aim and try again")
  can mask a systematic bug for months. If a failure mode is common
  enough to have friendly retry messaging, check whether it's actually a
  bug first.
- Doc-recommended tools become traps outside their envelope:
  `paintByCrease` floods a whole smooth head, `merge: {angleDeg: 30}`
  chain-merges a face. Every recommendation needs its failure envelope
  stated next to it.

**Longed for**
- `within` scoping on all geometric selectors (both v5 agents' shared
  ask; ideation proposal #1) — tracked in #881.
- Stable region identities across runs — replaying a recorded
  `detectRegions` id after the mesh re-tessellates paints garbage
  silently; tracked in #881.
- Session persistence for render-only imports (#883) — every Playwright
  spec re-imported 25MB for ~24s because `?session=<id>` reopens to the
  default sphere.
