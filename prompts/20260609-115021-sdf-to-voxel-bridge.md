---
session: "5c6e31e7"
timestamp: "2026-06-09T11:30:00Z"
model: claude-opus-4-8
tools: [explore, model-sculpt, web-search]
sequence: 1
---

## Human

Came across thi.ng (~350 libraries) and asked whether anything there could
help Partwright create 3D-printable models, specifically to expand voxel
features. After research, picked the highest-leverage move: bridge the existing
`api.sdf` system into the voxel engine. Then: "implement it and create 5 new
catalog entries leveraging the new capability. have subagents drive the
modeling for the catalog. have them give you feedback as they work and capture
it in the retro inbox. you review the quality of their work and have them
iterate on it if the quality isn't good enough. let's also try to ensure the
models are printable."

## Assistant

## Key decisions

**Why this feature, not a thi.ng dependency.** The thi.ng research showed
Partwright already out-equips most of what thi.ng would offer for voxels: the
grid is already a sparse packed-key `Map` (so `@thi.ng/morton` is redundant),
and there's already a rich `api.sdf` expression system (sphere/box/TPMS/gyroid,
smooth booleans, twist/bend/taper, domain repeaters) that lowers to Manifold via
`levelSet`. The real gap was that `api.sdf` was **manifold-only** — never bridged
to voxels. So the highest-leverage move needs **zero new dependencies**: rasterize
the existing SDF field onto the voxel lattice. (thi.ng's genuinely additive
pieces — `rle-pack` for color-stream compression, noise — are follow-ups.)

**Bridge design — sample, don't re-mesh.** Every `SdfNode` already exposes a CPU
`evaluate(x,y,z)` returning a standard-convention signed distance (negative
inside). So `v.sdf(node, opts)` just point-samples that field on the integer
lattice: voxel `(i,j,k)` ↔ world `(i·res, j·res, k·res)`, occupied when
`f ≤ level`. No Manifold, no levelSet, no marching cubes — faithful to the same
field the mesh path uses.

**Coordinate mapping: world-aligned, not bounds-relative.** Voxel coord `i` maps
to world `i·res` (not `bounds.min`-relative), so an origin-centered SDF yields an
origin-centered, symmetric voxel model — matches how the other voxel primitives
behave and how an AI author reasons about it. `res` = world units per voxel reads
naturally ("res:1 → 1 voxel/unit").

**Coloring reuses `.label()` regions, not a new scheme.** `colors` maps SDF
`.label(name)` → voxel color. Implemented via the already-exported
`partitionByLabel`: each cell is colored by the region it sits *deepest* inside
(min distance = SDF union semantics), so it's exactly the field evaluation for a
union of labeled parts. Unlabeled/unmapped geometry falls back to `color`. This
keeps color consistent with the existing paint-by-label model authors know.

**Layering.** `v.sdf` is a real method on `VoxelGrid` (grid.ts → sdf.ts is a new
forward edge; sdf.ts imports only apiValidation, so no cycle — confirmed with
`lint:deps`). The voxel sandbox exposes the *same* `api.sdf` namespace via
`createSdfNamespace`, but with a Proxy "build guard" that throws a pointed
message if anyone reaches for `.build()`/`levelSet` (there's no Manifold engine
in a voxel session) — the primitive/combinator methods never touch Manifold, so
they work unchanged.

**Safety knob, not a hardcoded constant.** A tiny `res` over large bounds could
sample hundreds of millions of cells and freeze the engine. Added
`import.voxelSdfMaxSamples` (default 8M) to `appConfig` + the advanced-settings
modal; `v.sdf` computes the sample count up front and throws (asking for a
coarser `res`/tighter bounds) before allocating. In the Worker this reads the
static default, which is the right behavior for a guard.

**Catalog generator extended for voxel.** `makeCatalogEntry.ts` was hardcoded to
`manifold-js`; added `--language voxel` (runs `voxelEngine.run`, then the same
`Manifold.ofMesh` stat round-trip the voxel mesher round-trips cleanly through).

**Docs/parity.** This is a sandbox modeling primitive (like `v.fillBox`), not a
`window.partwright` UI affordance, so the parity surface is the sandbox docs:
documented `v.sdf` + the voxel-session `api.sdf` in `/ai/voxel.md`, with a
cross-reference from `/ai/sdf.md`. No new `window.partwright` method or AI tool
is warranted (the chat AI already drives voxel modeling by writing sandbox code).

**Catalog modeling delegated to subagents.** Five `model-sculpt` agents each
drive one printable showcase (gyroid vase, TPMS lattice cube, porous coral,
smooth-blend blob mascot, twisted lattice pen-tower) through the headless
`model:preview --lang voxel` render→look→adjust loop, against explicit
printability gates (watertight, low component count, ≤200k tris, flat base).
They write only to `/tmp` scratch files (git stays single-writer); the primary
assembles the catalog entries and reviews quality, iterating where needed. Their
4Ls feedback on the new API is captured into `retros/inbox/`.
