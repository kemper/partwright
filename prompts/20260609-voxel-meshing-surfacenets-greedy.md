---
session: "kfva7f"
timestamp: "2026-06-09T13:30:00Z"
model: claude-opus-4-8
tools: [explore, model-preview, playwright]
---

## Human

A modeling agent flagged two voxel improvements: (1) greedy meshing — the mesher
is exposed-face-cull + vertex-weld, so a 32-long same-color run emits ~128
triangles instead of ~4; coalescing coplanar same-color quads is a big
triangle-budget win. (2) surface nets / marching cubes — `v.smooth()` is Taubin
relaxation on the block mesh (topologically identical to blocks); true smooth
voxels need dual contouring / surface nets. Consider what these get us and any
other voxel improvements.

User chose: implement greedy meshing AND surface nets; keep the existing Taubin
smoother; make `smooth()` take an optional algorithm parameter; make the new
smoother the default if it turns out well.

## Assistant

## Key decisions

**Surface Nets as a selectable smoothing algorithm, not a replacement.** Added
`algorithm: 'taubin' | 'surfaceNets'` to `Surfacing` and `smooth({ algorithm })`.
Taubin stays (it uniquely preserves block topology and honors `detail`
supersampling + the base-pin features). Surface Nets (`surfaceNets.ts`, the naive
binary-occupancy variant with the standard cube-edge/edge-crossing tables) builds
a smooth surface at native resolution and is manifold by construction. Per-quad
color comes from the solid voxel at each sign-changing edge, so it drops straight
into the existing per-triangle `triColors` pipeline. SN runs `iterations` light
Taubin passes on top so `flatBottom`/`baseLayers`/`lockBox` pinning still applies.

**Made Surface Nets the default** (`DEFAULT_SMOOTH_ALGORITHM`). `model:preview`
of a radius-8 sphere showed Taubin barely rounds at the same triangle count and
grows pole spikes (the μ anti-shrink pass over-extends isolated boundary
vertices), while SN is genuinely round, spike-free, manifold, same tri count, no
supersampling. That cleared the user's "default if it turns out well" bar.

**Greedy meshing is export-only — it cannot be the default render mesh.** Any
coplanar coalescing introduces T-junctions (verified: a uniform box stays
manifold at 12 tris, but a stepped sphere or a 2-color slab does not), and
`Manifold.ofMesh` rejects T-junction meshes. Voxel models reconstruct through
`ofMesh` for stats (volume/genus), the printability pill, AND slicing
(`currentManifold`), so a greedy render mesh silently regresses all three to
render-only. I asked the user; they chose export-only. So `meshGrid`'s blocks
path stays the per-face manifold mesh, and a new `greedyMeshGrid` is used only by
the STL/OBJ/3MF file exporters (triangle soup — T-junctions are harmless there)
via a `fileExportMesh()` helper that re-derives the grid (reusing the existing
`getCurrentVoxelGrid`). GLB stays per-face: it serializes the live render scene,
not a MeshData, so injecting greedy geometry there would be invasive. A 20×20×1
slab export dropped from ~1680 triangles to 12 (684-byte STL).

**Verification.** Unit tests for greedy (single voxel == per-face, solid box →
12 tris manifold, flat slab collapse, color-boundary no-merge, empty grid) and SN
(default selection, finite/colored mesh, flatBottom flat, empty grid); existing
base-pin tests pinned to `algorithm: 'taubin'` since they assert block topology.
Real-browser checks: SN sphere-on-pedestal renders rounded with a flat base and
`isManifold: true`; greedy STL/3MF export succeeds end-to-end. All voxel e2e
(incl. the ofMesh round-trip suite) green.

Other voxel ideas surfaced for later (not built): ambient occlusion for blocky
models, grid boolean CSG, a real triangle-budget gate in the voxelizer, more grid
primitives, LAB color snapping for VOX export, area downsampling for image import.
