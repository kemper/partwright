---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
---

## Human

Continue the v5 bundle: wire the subagent-built pure modules (regionFit,
symmetry, faceGroups merge) into the console API + AI tool layer, and
rewrite the agent workflow doc around the new pipeline.

## Assistant

The wiring slice that turns three pure modules into the agent-facing
pipeline: **detect (merged) → see (grid) → fit → paint (analytic disc) →
mirror → audit**.

**`detectRegions({merge})`** plumbs the agglomerative post-pass through:
one visual feature (a pupil split across 3-4 watershed shards) comes back
as one region.

**`fitRegionShape` + `paintRegionFitted`.** Fit the analytic
disc/sphere/plane to a region's boundary; paint the disc via the smooth
oriented-cylinder selector. `paintRegionFitted` refuses on a poor fit
(rms > 0.25×radius) instead of stamping a wrong circle. Default disc
thickness is 2× the fitted radius — a browser test on a hemispherical eye
dome showed the fitted circle sits at the dome BASE, so a radius-thick
disc painted a ring and left the cap bare; 2r covers the full dome and
the inward half aims into the solid, harmless on closed geometry.

**`paintMirrored` + `listComponents().symmetry`/`mirrorOf`.** Descriptor
reflection for the analytic kinds (box/shape via M·R·S conjugation —
composing with a LOCAL x-flip keeps det +1 and is a symmetry of every
shape variant including cones; slab via reflected point-on-plane;
seed kinds via reflected seed+normal; cylinder shells per-axis), with
per-triangle centroid mirroring as the fallback for raw sets. The browser
check painted one fitted red eye and mirrored it to a blue one —
byte-symmetric placement, different colour, `method: 'descriptor'`.
Symmetry is also reported from the manifold decompose branch (plane only;
no mirrorOf there because decompose ordering ≠ island ordering).

**AI tool layer**: six new schemas (renderRegionGrid, paintDisc,
fitRegionShape, paintRegionFitted, paintMirrored, auditPaint), fan-filter
params on paintFaces, `merge` on detectRegions, `shape` on
paintInOrientedBox, `island` on probePixel's view — all added to
PART_TARGETABLE_TOOLS, gated sets (paints in PAINT_GATED; read-only
renders/fits/audit in ALWAYS_AVAILABLE), and the dispatch switch.

**colors.md** rewritten around a mandatory three-phase protocol —
IDENTIFY (roles table persisted to session notes before any paint) →
PAINT (analytic-first primitives, mirror the second side) → AUDIT
(dismiss or fix every auditPaint flag) — since interleaving
identification with painting was the biggest observed quality killer
across five validation rounds.
