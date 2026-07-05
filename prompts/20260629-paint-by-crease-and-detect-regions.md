---
date: 2026-06-29
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/faceGroups.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
  - tests/unit/detectRegionsExtension.test.ts
  - tests/island-paint.spec.ts
---

## Human

After the 4-agent Pomni validation pass produced a recognizable harlequin
silhouette but **no face / eyes / mouth / blush**, the user pushed back hard
("I've seen very little so far that would lead me to believe this is even
worth merging") and shared past-AI-session feedback that named the actually-
right primitive: **dihedral-angle (crease) watershed segmentation**. The user
asked for a strategic recommendation, then green-lit folding the right tools
into this branch and re-running the validation against the only success
criterion that matters — "does the face come out white with red eyes."

## Assistant

**Audited before implementing.** The crease-watershed kernel was already in
the codebase: `findCoplanarRegion` (src/color/adjacency.ts) does the right
adjacent-pair bend gate, and `computeFaceGroups` (src/color/faceGroups.ts)
already runs exhaustive multi-seed BFS on top of it. `paintRegion` already
calls it. The gap was three things:

1. **Wrong defaults.** `computeFaceGroups` defaulted to `tolerance = 0.9995`
   (≈1.8°), which over-fragments organic sculpts. For sculpted features
   (iris ring, mouth crease, pom-poms) the right threshold is ~20° crease
   = `tolerance ≈ cos(20°) ≈ 0.94`.
2. **No way to constrain to one mesh-island.** Pomni's body is a fused
   205k-tri island; segmenting the whole mesh runs the BFS through other
   islands too. Added `restrictTo: Set<number>` to `computeFaceGroups`
   and a sibling `findCoplanarRegionConstrained` that won't walk outside it.
3. **No region-adjacency graph.** The iris borders the sclera; the pupil
   borders the iris. Added an opt-in `includeNeighborIds` post-pass: walk
   each triangle's neighbours once, cross-reference the group assignment,
   build per-group `neighborIds: number[]`.

**New agent-facing APIs:**

- `partwright.detectRegions({creaseAngleDeg=20, minTriangleCount=5,
  maxRegions=64, withinIsland?, includeNeighbors=true})` — wraps
  `computeFaceGroups` with sculpt-tuned defaults and the new `restrictTo`
  filter (resolved from `meshIslands` + `trianglesInIsland`). Returns regions
  sorted largest first with `{id, triangleCount, area, centroid, normal, bbox,
  neighborIds, source: 'whole-mesh' | 'island'}`.
- `partwright.paintByCrease({seedPoint, seedNormal?, creaseAngleDeg=20, color,
  name?})` — wraps the existing `findCoplanarRegion` paint commit path, but
  parameterised in DEGREES (sculpt-natural) instead of cosine. Snaps to
  nearest triangle if normal not provided (forgiving of probePixel rounding
  on iso views).

Both are wired into `help()`, the AI-tools dispatcher, `PART_TARGETABLE_TOOLS`,
and `PAINT_GATED`.

**Workflow doc.** Added a "For SCULPTED FEATURES inside a fused mesh —
`detectRegions` + `paintByCrease`" section to `public/ai/colors.md` with the
listComponents → detectRegions({withinIsland}) → probePixel → paintByCrease
recipe, plus a four-case decision tree: paintIsland (clearance-gap kits) vs
detectRegions+paintByCrease (fused features) vs paintInBox/Slab (flat
regions) vs paintByLabel (authored geometry).

**Tests.** `tests/unit/detectRegionsExtension.test.ts` — 7 cases: cube splits
to 6 faces at 20°, default 1.8° also gives 6 (coplanar faces); restrictTo
filters correctly and returns empty when set is empty; cube faces have
exactly 4 neighbours each; single-triangle has empty neighbours; two disjoint
boxes never list each other's faces as neighbours. `tests/island-paint.spec.ts`
got an e2e case: detectRegions on a Manifold cube returns 6 regions with 4
neighbours each, and paintByCrease seeded at z=10 colours exactly the top
face (2 triangles, stops at the 90° crease).

**Pre-existing crease-watershed gate** in `findCoplanarRegion` was correct;
no kernel changes needed. The whole new surface is wiring + defaults +
documentation + one constrained-BFS helper for `restrictTo`.
