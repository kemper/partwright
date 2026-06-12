---
session: "aiK0c"
timestamp: "2026-06-11T20:00:00Z"
sequence: 1
---

## Human

(Continuing the click-to-insert palette, PR #205.) I like the direction.
Requests:
1. Add the recently-merged `api.container` option to the insert menu.
2. Add a toggle in the insert modal to switch to a drag mode — select an
   object and freely move it (instead of orbiting) so parts can be positioned
   before unioning.
3. Reconsider auto-union on every insert — not sure that's always wanted. Also
   the first inserted shape doesn't always union with existing returned
   geometry (created a box, the code just returned the box, dropping prior
   work). Open to recommendations; want something consistent across engines.
4. The voxel engine inserts manifold-js code rather than voxelized shapes, and
   no BREP versions are generated. Omit shapes that are hard/impossible per
   language. Repeat the plan back before implementing.

## Assistant

## Key decisions

**"api.container" resolved to `api.enclosure`.** No `api.container` exists in
the tree; the recently-merged namespace is `api.enclosure` (project boxes /
shells / standoffs). Confirmed with the user, who asked for all three inserts
(box, shell, standoff), manifold-js only.

**Consistency model — visible union, explicit combine.** The two single-return
engines (manifold-js, replicad) now fold inserts into a readable array union
(`Manifold.union([...])` / `BREP.fuseAll([...])`); the statement engines (scad,
voxel) union implicitly. Added an **Auto-combine toggle** (default on; hidden
for scad/voxel where union is intrinsic) so a user can insert parts without
showing them and combine later — the user picked this option.

**The never-drop fix (the reported bug).** Replaced `addJsDeclaration`'s
mode-based logic with engine-aware `addManagedDeclaration`. Cardinal rule: never
silently drop existing geometry. A bare-identifier or managed-union return is
extended; a real hand-written return is *wrapped* into the union; only a
throwaway placeholder (a lone constructor call in a program with no named parts,
i.e. a fresh default) is replaced. Operations remove their operands from the
union and insert the result in their place. Added `removeManagedPart` so Delete
also prunes the union (the old `removeJsDeclaration` left a dangling reference).

**Per-engine codegen + gating.** Extended `InsertLanguage` to all four engines.
BREP reuses the JS controller transforms (same `const x = ….translate([…])`
syntax) with `BREP.*` constructors + `fuse/cut/intersect`. Voxel mirrors the
SCAD statement model: `v.fillBox/sphere/cylinder` + `v.sdf(api.sdf.torus(…))`,
integer-rounded, tagged `// part:`, with moves re-emitting the statement (voxels
bake position into args — no translate to bump). A `SHAPE_SUPPORT` map hides
shapes an engine can't do natively (BREP: cube/sphere/cyl/cone/torus; voxel:
cube/sphere/cyl/torus), and the palette hides Operations for voxel and Mirror
for voxel+replicad (BrepShape has no `.mirror`).

**Drag mode.** Surfaced the existing Tinkercad-style build session as a
prominent "✥ Move / arrange shapes" toggle at the top of the panel; it now
reopens the palette on exit so it reads as a round-trip.

**Two bugs caught in manual browser verification** (screenshotted every engine):
(1) `enclosure.box` returns `{ base, lid }` — emitting `const { box, lid }`
bound the wrong key → `undefined`; fixed to bind the real keys with aliasing.
(2) The voxel scaffold emitted bare `voxels()` (sandbox only exposes
`api.voxels`) and didn't reconcile an existing inline `return api.voxels()…`,
producing a double grid + early return; rewrote `ensureVoxelScaffold` to use
`api.voxels()` and bind an inline returned grid to a handle. Verified the
enclosure box reports `componentCount === 2` via `model:preview`.
