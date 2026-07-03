---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/faceGroups.ts
  - src/color/meshIslands.ts
  - src/main.ts
---

## Human

Keep iterating toward Opus 4.8 agents succeeding at the Pomni STL paint
task. Implement the recently filed issues (#881) as needed; PR size is not
a concern — result quality is. Use ideation subagents to find new
capabilities.

## Assistant

First slice: #881 items 1 and 4, the two follow-ups both v4 Opus agents
independently asked for.

**Fan-topology metadata (#881.1).** `computeFaceGroups` now reports
`maxTriangleArea`, `medianTriangleArea`, and `worstTriangleAspectRatio`
per group, and `detectRegions` adds a derived `fanTopologyRisk` boolean
(max/median > 20× or aspect > 8) so an agent can see the bleed hazard
BEFORE painting. `paintFaces` gained the matching `maxTriangleArea` /
`maxTriangleAspectRatio` filters with an `excludedByFilter` count in the
response. Aspect ratio metric chosen as longestEdge²/(2·area) — the
altitude form — because it's cheap, unitless, and scores fan wedges 10+
vs ~1.15 equilateral; the same helper backs both the detect-side
diagnostic and the paint-side filter so they can't drift.

**True PCA principal axes (#881.4).** `meshIslands` now accumulates
area-weighted first+second centroid moments during the island BFS and
runs power iteration on the covariance (seeded with the bbox axis for
deterministic tie-breaks, bbox fallback on degenerate islands, sign
normalized so the largest component is positive). `principalAxisVector`
is now the island's TRUE long direction — a tilted limb reports its own
axis, not the nearest world axis. `paintOrientedStripes` banding switched
from world-axis bbox coordinates to projections onto that vector, and its
`axis` override now also accepts an arbitrary `[x,y,z]`. `principalAxis`
(the string) stays bbox-based for back-compat.

Both changes came out of the v4 validation: Opus G's face bleed traced to
fan wedges painting past the iris, and diagonal limbs striped along world
Y instead of the limb axis.
