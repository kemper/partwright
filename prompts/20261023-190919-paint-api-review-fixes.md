---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T19:09:19Z"
tools: [subagent, git-worktree, vitest, playwright]
---

## Human

Review feedback on the #1049 follow-ups (PR #1074):
1. The persisted refined mesh drops the base's per-triangle colours.
2. The cache key hashes label sizes instead of label membership.
3. Storing the refined mesh on every version risks storage and quota blow-ups; move it to a local LRU cache.
4. `acceptParts` drops seed `maxRadius`/`color`.
5. `paintAlongBoundary` needs a loop cap and a single undo step.
6. `paintFaces` ids get the wrong mesh-space semantics.
7. Bound the T-junction scan.
8. Version the cache key from the refine algorithm.
9. random-walker `maxRadius`.
10. Small API edges.

## Assistant

## Key decisions

**Local cache instead of the version record (item 3).** The refined mesh now lives in a new IndexedDB store, `paintRefineCache` (DB v9):
- **Key and value.** It is keyed by the content key and holds `{ key, mesh, toRoot, bytes, lastUsed }`. A `[lastUsed, bytes]` index lets eviction walk entries newest-first and sum their sizes with a key cursor, without loading any mesh.
- **Writes.** After a save commits, and after a restore that had to rebuild, the cache is written in its own best-effort transaction. A quota error just skips the cache and never fails the save.
- **Reads.** A hit re-stamps `lastUsed` at most once per configurable interval, because a re-stamp rewrites the whole row.
- **Session deletion.** There are no per-session links, so a deleted session's entries age out through the LRU. `clearAllData` and the Data-tab wipe clear the store outright.
- **Config.** The budget (MB), the touch interval and a lower per-entry cap (1M triangles) are advanced settings.

Versions, exports and share links carry nothing. The schema 1.21 bump and all 7 migration touches are reverted cleanly (the storage files match the pre-feature base again). An imported session rebuilds once, then caches.

**Colours (item 1).** The cache stores the plain mesh. On restore, `propagateTriColors(base, mesh, toRoot)` (now exported) rebuilds `triColors` and `_painted` exactly as the live refine had them. A unit test with a coloured base proves the arrays are identical.

**Key (items 2 and 8).** The key is now made of:
- `REFINE_ALGO_VERSION` (exported from `subdivide.ts`, now 2);
- the base mesh content key (incl. colours);
- the descriptors;
- an FNV hash over each label's name and its sorted triangle ids, memoized per label map.

**Seeds (items 4 and 9).** `acceptParts` saves each pin's `maxRadius` and `color`. `normalizeImportParts` keeps them when well-formed and drops malformed pins. The e2e test checks that accept → reopen → rerun keeps the cap and the same partition. random-walker now honours the cap: a label whose seeds are all capped can only win triangles inside their geodesic balls, and the warm start gets the caps too.

**Boundary paint (item 5).** A new `ui.boundaryPaintMaxLoops` setting (default 8) keeps the longest loops; the rest are reported as `skippedLoops`. `regions.ts` gained `runAsUndoGroup`. Regions added inside one call share an `undoGroup`, and undo/redo move them together. The group is transient and never serialized.

**`paintFaces` ids (item 6).** I checked which mesh a `triangles` descriptor refers to. Rehydrate and full rebuilds resolve it through base → refined, so stored ids must be base ids. `paintFaces`, `paintInBox` and `paintNear` (through `commitPaintFromSet`) were storing ids of the refined mesh, which meant a different selection after a reload. They now record the base triangles the given ids belong to, and paint all of their current children live too, so live matches reload. The docs steer exact part scoping to `withinPart`.

**Smaller fixes.**
- **T-junction repair (item 7):** it marks the endpoints of split edges and skips triangles with fewer than two marked corners. It also gives up, keeping the T-junctions, past `MAX_REFINED_TRIANGLES`.
- **`seedLandings` (item 10):** it uses a centroid grid with an exact ring stop. A unit test matches brute force, including points far outside and inside the mesh.
- **`partBoundary` (item 10):** `capPolylinePoints` guarantees at most `maxPointsPerLoop` points and keeps both ends of an open chain.
- **`probePixels` (item 10):** a `modelPixelBounds` of `null` (model not in view) is documented.
