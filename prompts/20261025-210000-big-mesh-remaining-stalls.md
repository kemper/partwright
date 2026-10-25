---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-25T21:00:00Z"
model: claude-opus-5-5
tools: [playwright-cdp-profiler, vite-node]
---

## Human

Work on the rest of #1129 (the remaining big-mesh stalls left after #1130).

## Assistant

## Key decisions

Every item was measured with the user's 3.7M-triangle STL before and after.

**Simplify / Enhance results.** The engine Worker now builds a Manifold of a
big result (≥ `renderer.lazyManifoldMinTriangles`) and sends `manifoldFacts`,
or `manifoldError` when the result isn't a solid. The facts are validated like
a run's. `applyLiveGeometry` takes them, or an already-built Manifold, and
defers the main-thread rebuild. `healModel` hands over the Manifold it already
built. `snapshotMeshAsVersion` uses the baseline's facts. Run facts are no
longer gated to manifold-js: SCAD and replicad also return their live
Manifold's own `getMesh()`.

**Worker facts pass (~8.5 s → 1.6 s).** For big meshes the component census
comes from the mesh, not `decompose()` + boolean `intersect()`: the piece
split, per-piece signed volume and bbox, and a sampled +X ray-parity test for
containment. A unit test runs both paths on real manifold-3d solids
(disjoint, enclosed, overlapping, nested) and they agree; on the user's file
both give 3 / 0 / interpenetrating. Small models keep the exact path.
`edgeStats` lost its per-triangle array + `Math.hypot` (1 s → 0.09 s).

**3MF probe.** The quick check stays on the main thread (it is fast now). A
mesh that fails it gets the exact ofMesh weld ladder in the STL probe Worker,
with a main-thread fallback. `weldMesh` moved to `geometry/weldPositions`.

**First open of a big import after a reload.** The engine spends 10–15 s
rebuilding a solid from a mesh we already hold. When the code is exactly the
generated single-import wrapper, `runCodeSync` shows that mesh at once under
the existing "⚡ Fast preview" pill. A brand-new import gets the same
treatment, so the model now appears seconds earlier there too.

**Not done: storing version meshes as Blobs in IndexedDB.** Measured: a
version `put()` blocks ~0.55 s on the structured clone of a 67 MB mesh, and
a get blocks ~0.18 s. As Blobs it would be ~0.07 s and 0 s. But it changes
the on-disk record shape. An older build sharing the origin's IndexedDB (a
rollback deploy, a stale tab, the pinned /v1 mount) would fail to load those
versions. That is a compatibility call for the owner, so it stays tracked in
#1129 with these numbers.
