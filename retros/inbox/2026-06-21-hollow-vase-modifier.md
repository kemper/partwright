---
date: 2026-06-21
author: claude (opus-4-8)
task: Hollow / vase-mode surface modifier (PR #557)
---

## Liked
- The "mirror the Voronoi lamp exactly" framing made the initial build mechanical: one `combine` closure over `sdfModifierMesh`, then the same wiring loop (id → modifiers → modal tab + palette → window API → AI tool → docs). Having a named sibling template is the single biggest accelerator for "add another X like Y" tasks.
- Browser verification caught two real bugs TypeScript and unit tests could not: a sub-5-voxel wall meshing non-manifold (rejected by `Manifold.ofMesh`), and a sealed shell collapsing to a solid because `largestMeshComponent` dropped the inner wall. Both only show up as `getGeometryData().status === 'error'` after the commit re-runs — the spec-driven screenshot loop is non-optional for SDF/mesh work.
- Diffing my failure against the shipped `applyVoronoiLamp` on the *same* frustum proved the non-manifold-on-taper limitation was pre-existing scaffolding behavior, not my bug — saved me from chasing a fix that wasn't mine to make.

## Lacked
- A headless way to run a surface modifier through `Manifold.ofMesh` validation. `model:preview` runs user code, not modifier functions, so every "is the baked shell manifold?" check needed a full Playwright round-trip (~10s each). A `model:preview --modifier hollow model.js` (or a node harness that calls `applyHollow` + ofMesh) would have collapsed the wall-thickness/resolution sweep from ~6 browser runs into seconds.
- Early signal that `componentCount: 2` is *correct* for a sealed shell (two surfaces) vs a bug. I initially asserted `componentCount === 1` in the e2e and it failed; the mesh-vs-solid component distinction (like the voxelPieceCount caveat) deserves a one-liner in the surface-modifier docs.

## Learned
- The shared SDF `watertight` flag conflated two operations — a field-level fragment cull AND a mesh-level largest-component reduction. They needed decoupling (`keepLargestMeshComponent`) for any closed-shell feature. A single boolean controlling two pipeline stages is a latent trap for the next volumetric modifier (infill, cage).
- Whole-model-only tabs (voxelize/voronoiLamp/hollow/engrave) were silently Apply-disabled because `regionBlocked()` gated on a region selection their hidden UI can't make. I fixed it independently and so did a parallel PR (`REGIONLESS_TABS`) — a sign this is a real sharp edge worth a structural fix, not two ad-hoc sets.

## Longed for
- Merge cost dominated the back half: a parallel PR made `sdfModifierMesh` async, added knurl/engrave, consolidated the per-texture AI tools into `applySurfaceTexture`, and renamed my exact UI fix. Eight conflicted files, two of them 130-line tangles where git interleaved my new function with theirs. Landing volumetric-modifier work behind the async/`SdfRunControl` refactor *first* (or smaller, faster-merging PRs) would have avoided re-deriving the integration. When two agents touch the same subsystem in the same week, the second pays a large, avoidable tax.
