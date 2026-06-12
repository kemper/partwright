---
session: "01TLwb"
timestamp: "2026-06-08T17:00:00Z"
---

## Human

In Voxel Studio, let people control the **XYZ size** of a large voxel block
when *adding* voxels, and control the **depth** of how they're added. The
problem: adding a 5×5 block onto a 1-thick imported tile landed it halfway, so
2–3 layers stuck out both the front and the back. They want it to attach to the
*front-most* surface by default, but also be able to embed it / set a general
depth so it feels like "painting" new voxels onto a model. Then, separately:
make the size and depth settings work for the **box fill** and **box subtract**
tools too.

## Assistant

## Key decisions

**Add tool → an anchored block instead of a centered round brush.** The old
`add` stamped a sphere/cube/diamond brush centered on `clickedVoxel + normal`,
so a thick brush straddled a thin tile and poked out both sides. New
`addBlockCells(voxel, normal, size, depth)` (edits.ts) lays a world-axis
`[x,y,z]` box that is **centered on the two axes tangent to the clicked face**
but **anchored along the normal** — its near layer sits flush against the
surface and it grows outward. That structurally prevents back-poke. `depth`
sinks it inward (0 = on top / front-attach; `size`-along-normal = fully
embedded). Crucially, the default `[1,1,1]` + depth 0 reduces *exactly* to the
legacy `addTarget` single-voxel add, so existing behavior/tests are unchanged.

**Box tools → depth extrudes the selection; size is already the two corners.**
The box tools are two-click region ops, so the two corners already fix the X/Y/Z
extent — a separate "block size" has no meaning there. What they lacked is
*thickness* perpendicular to a flat (coplanar) selection. New `extrudeBox(a, b,
normal, depth, into)` extends the box `depth` extra layers along the completing
click's face normal: `boxAdd` grows a slab outward, `boxRemove` carves inward.
`depth 0` returns the corners unchanged (legacy behavior preserved). Threaded
the completing click's `triNormal` into `applyBox`. I deliberately did **not**
wire the XYZ sliders to the box tools (they'd be redundant/confusing); the panel
shows only Depth for box, and I flagged this choice to the user.

**UI.** Split the brush panel: paint/remove keep radius/shape/spray; `add` shows
a Block-size section (X/Y/Z sliders, 1..16) ; a shared Depth section shows for
`add` + both box tools, with tool-aware labels ("on surface"/"N deep" for add,
"flat"/"+N layers" for box). The hover/delete preview overlay now draws the full
add-block footprint (via `addBlockCells`) so size/depth are visible before
committing.

**Parity.** Extended the `setVoxelBrush` console/AI API with `block` and
`depth` (validated, returns resolved settings) and documented both in
`public/ai/voxel.md`, keeping the UI↔JS-API parity rule.

**Verification.** Build clean; unit tier 815 pass (added `addBlockCells` /
`addBlock` / `extrudeBox` coverage incl. the thin-tile front-attach and the
non-coplanar extrude-axis edge case). Browser-verified both flows with throwaway
Playwright specs + screenshots: a 3×3×4 block front-attaching to a 5×5×1 tile
(25→61 voxels, none overlapping) and a box-fill extruding a raised slab
(depth +3, 25→37). Scratch specs deleted before commit.
