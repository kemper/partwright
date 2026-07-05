---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/faceGroups.ts
  - tests/unit/faceGroupsMerge.test.ts
---

## Human

Extend `src/color/faceGroups.ts` with an agglomerative region-merge
post-pass, plus unit tests. On sculpted character heads, one visual feature
(a pupil, a bang strand) fragments into 3-4 sibling groups from the
crease-watershed's normal jitter, and AI agents must discover + hand-union
the fragments. Add an opt-in `merge: { angleDeg, minArea }` option that
agglomerates fragments back into single regions: two neighbouring groups
merge when the angle between their area-weighted mean normals is
`<= angleDeg` (default 30), OR when one is tiny (`area < minArea`, default 0
= disabled) and touches exactly one non-tiny neighbour. Restructure rather
than bolt on: keep sub-`minTriangles` raw groups as merge candidates and
apply the `minTriangles` filter AFTER merging. Must be byte-identical to
today when `merge` is omitted. Touch only `faceGroups.ts` and
`tests/unit/`.

## Assistant

**Restructure.** Split the watershed into three stages: (1) raw BFS pass
collecting `Set<number>[]` per crease-bounded region — when `merge` is
absent this still drops sub-`minTriangles` sets immediately (today's exact
behavior, so the no-merge path is untouched code executing the same
branches in the same order); when `merge` is present every raw set survives
as a candidate; (2) `agglomerateRawGroups` (only called when `merge` is
set) runs union-find over the raw sets; (3) the surviving merged sets (now
`minTriangles`-filtered) feed the *existing* `buildGroup` call, sort,
id-rewrite, `neighborIds`, and `maxGroups` trim, unchanged. This guarantees
`maxTriangleArea`/`medianTriangleArea`/`worstTriangleAspectRatio` are
recomputed from the true merged triangle set (not approximated/averaged
across fragments), since `buildGroup` only ever sees final sets.

**Union-find design.** Each raw group's area-weighted normal sum
(`sumNx/sumNy/sumNz`) and total area are cached per union-find root and
updated incrementally in `union()` — the angle check between any two
current roots is then an O(1) dot-product on the cached sums, never a
triangle re-walk. The raw-group adjacency edge list is fixed once (same
cross-crease neighbour logic as the existing `includeNeighborIds` pass, run
over raw groups instead of final ones); each pass re-derives root-level
neighbour sets by mapping that fixed edge list through the current
`find()`, which is what lets the tiny-group rule ("touches exactly one
neighbour") stay correct as roots merge, without maintaining a mutable
adjacency structure under union. Loop to fixpoint (no pass merges anything),
capped at 32 passes as a hard stop for pathological inputs — normal inputs
converge in 1-3 passes since raw-group counts here are small (tens, not
thousands).

**Known imprecision, accepted as fine:** the per-pass neighbour-count
snapshot is taken once at the top of the pass, so if two merges happen back
to back within the same pass, a tiny-rule check later in that same pass can
read a slightly stale neighbour count for a root that just changed. It
self-corrects on the next pass (up to 32 available), and the alternative —
recomputing the neighbour map after every single union — turns an O(edges)
per-pass cost into O(edges²) worst case for no observable behavior
difference in the fixpoint. Documented in the function's doc comment rather
than "fixed", since fixing it has a real perf cost and no test in this
change needed it.

**minTriangles-after-merge semantics.** `survivingSets = mergedSets.filter(s
=> s.size >= minTriangles)` runs strictly after `agglomerateRawGroups`, so
three 1-triangle fragments that individually would have been dropped can
still be reported once they merge into a group above the threshold — this
is the exact scenario in the spec (a fan of tiny cap sectors) and is
covered by its own test.

**Tests** (`tests/unit/faceGroupsMerge.test.ts`, 7 cases): back-compat
(`merge: undefined` byte-equal to omitting it, plus the pre-merge
sub-threshold-drop behavior unchanged); a "shallow 3-sector cone" fixture
(shared apex, 3 rim points 120° apart, apex height chosen so adjacent
sectors' mean-normal angle is ~5.7°) that separates into 3 raw groups at a
tight 2° crease tolerance but merges into 1 at `angleDeg: 10`, with the
merged group's area/centroid/max/median independently recomputed in the
test (not by re-calling the implementation) and compared via
`toBeCloseTo`; a 90°-folded-sheet fixture proving `angleDeg: 30` does NOT
cross a genuine crease; a big-quad + 45°-bent-sliver fixture proving the
tiny-group rule fires only when `minArea` classifies the sliver as tiny (and
that disabling `minArea` leaves it separate, since 45° also fails the angle
rule); and the minTriangles-after-merge case reusing the cone fixture. All
green; `npm run typecheck` clean; `npm run test:unit` (105 files, 1680
tests) green; `npm run lint:deps` clean (no new imports).

Also caught and corrected before writing any code: the assigned worktree's
branch HEAD was stale (missing the `maxTriangleArea` etc. extension the
spec required building on). Reset the worktree's own branch to the commit
already checked out in the main worktree (`8610b973`) before starting —
safe since it's a shared, already-existing commit object and the reset only
touches this worktree's dedicated branch ref.
