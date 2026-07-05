---
date: 2026-06-29
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/meshIslands.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
  - tests/unit/meshIslands.test.ts
  - tests/island-paint.spec.ts
---

## Human

The user shared an articulated 25-piece print-in-place Pomni STL plus a
reference photo and asked an AI to paint it. The session failed: every paint
selector picks triangles by spatial position, so on a tightly-packed kit where
parts overlap in XYZ (hat over face, gloves touching pants) every box/sphere/
cylinder selector bled across part boundaries. `listComponents()` errored
because the import was render-only (non-manifold → no `Manifold.decompose()`).
The chat AI's own retro nailed it: "a select-by-mesh-island paint tool" was
the missing primitive. A follow-up note added "the box/slab edges are jagged
because the selectors pick whole triangles by centroid."

The user reviewed two rounds of design and chose: (1) per-triangle island IDs
+ render-only `listComponents` + `paintIsland`, and (2) smooth edges on
`paintInBox` — noting that smooth-edge machinery already existed for the other
selectors and `crispEdge` was likely just an alias.

## Assistant

**Re-verified before implementing.** The user was right: `paintInOrientedBox`,
`paintSlab`, and `paintInCylinder` already accept `{smooth, resolution,
maxEdge}` (default `smooth: true`) via `shapeRefineRegion` /
`slabRefineRegion` / `cylinderRefineRegion` in `src/color/`, routed through
`addRegion` with `withSyncReconcile`. The lone holdout is **`paintInBox`
(AABB)** — which is the *first* selector an AI reaches for, which is why the
session hit jaggedness. So the fix is "extend `paintInBox` with the existing
smooth API," not "invent crispEdge."

**Island detection on `buildAdjacency`.** `src/color/adjacency.ts` already
welds vertices by exact position for the flood-fill primitives, so its neighbor
graph IS the right substrate for face-connected island BFS. New
`src/color/meshIslands.ts` runs the BFS, memoizes on a WeakMap keyed by
MeshData (new engine run → fresh mesh → fresh entry), exports
`meshIslands(mesh) → {triIslands, islands[{index, triangleCount, bbox,
center}]}`, plus `trianglesInIsland(...)` and `islandAtPoint(point)`.
Documented the known limitation (parts touching at a shared vertex merge into
one island) — unavoidable without external part metadata and matches
`Manifold.decompose()`'s behaviour.

**`listComponents` fallback.** Kept the manifold path verbatim (still returns
`volume`/`surfaceArea`); added a `mesh-island` branch when `currentManifold`
is null but `currentMeshData` exists. Tagged the source as `'manifold'` or
`'mesh-island'` so callers can tell which kind they got. Render-only STL
imports now segment without needing a Manifold round-trip.

**`paintIsland` + `paintIslandAt`.** New API methods on `partwrightAPI`,
wired into `help()`, exposed as AI tools, added to `PART_TARGETABLE_TOOLS`
and `PAINT_GATED`. `paintIsland({index, color})` collects the island's
triangles via `trianglesInIsland` and commits through the existing
`commitPaintFromSet` (same render/storage path as `paintFaces`).
`paintIslandAt({point, color})` finds the nearest triangle, resolves its
island, then delegates — for pairing with `probePixel` so the AI can say
"paint the island under this pixel" without enumeration.

**`paintInBox` smooth.** Added `{smooth, resolution, maxEdge}` to the schema.
When smooth is on AND no `normalCone`/`topOnly`/`coverageMode`/
`maxTriangleArea` filters are set, the AABB is converted to an
identity-quaternion OBB and routed through the same `addRegion('box', ...)`
descriptor path that already does boundary-subdivision for
`paintInOrientedBox`. With filters present, smoothing is silently skipped
(the filter combinatorics aren't worth extending the 'box' descriptor for
now) and the legacy `commitPaintFromSet` branch handles it.

**Tests.** `tests/unit/meshIslands.test.ts` covers single/multi-island BFS,
the 25-disjoint-triangle scale, empty meshes, the WeakMap cache invariant,
plus `trianglesInIsland` / `islandAtPoint`. `tests/island-paint.spec.ts`
imports a three-cube binary STL via `importMeshData`, asserts
`listComponents` returns 3 components and each `paintIsland` colors exactly
12 triangles (no bleed) — and that `paintInBox` returns `smooth: true` by
default on a plain AABB. The three-cube STL is watertight enough to land on
the manifold path; the assertion accepts either source since both share
`meshIslands(currentMeshData)` for island enumeration.

**AI docs.** `public/ai/colors.md` got a new "Paint by part on multi-part STL
imports — `paintIsland`" section above `paintComponent`, with the
listComponents→paintIsland recipe and the touching-parts limitation.

Preflight (typecheck + 1660 unit tests + lint:deps + lint:consistency) all
green; the consistency warnings are pre-existing mousedown advisories
unrelated to this diff.
