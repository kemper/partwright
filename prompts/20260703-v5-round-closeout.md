---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - public/ai/colors.md
  - src/ai/tools.ts
  - retros/inbox/20260703-v5-pomni-paint-pipeline.md
---

## Human

(v5 round close-out.) Both Opus 4.8 validation agents finished — the
best results of any round, both recognizable Pomnis with clean symmetric
per-side eyes, one with a curved 3-disc smile. Fold their converged
feedback into docs; track the code asks.

## Assistant

Two failure envelopes both agents hit are now stated next to the
recommendations that walked them into it:

- **`paintByCrease` flood hazard** — on a smooth organic head the
  "boundary" is a gentle slope and the flood swallows the entire 205k-tri
  island (happened twice). colors.md and the tool schema now say: sanity-
  check the returned `triangles` count against the feature size, undo on
  overshoot, and prefer the analytic `fitRegionShape → paintDisc` path
  on smooth meshes, which cannot flood. The decision tree entry for fused
  islands now leads with `paintRegionFitted`, not `paintByCrease`.
- **`detectRegions` id instability** — ids renumber whenever the mesh
  re-tessellates (any smoothing paint does this). Replaying a recorded id
  in a later run paints garbage silently. Documented: capture triangleIds
  at detection time or re-derive by centroid; never replay ids.

Code-level fixes (a `maxTriangles` bound on the flood, stable region
identities, `within` scoping on the geometric selectors) are tracked as
the v6 list on #881 rather than grown onto this PR. Retro note filed
covering the round's meta-lessons (ideation agents finding the
probePixel bug + the fan-bleed impossibility proof; workaround-to-tool
promotion; miss-messaging masking systematic bugs).
