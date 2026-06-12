---
session: "aiK0c"
timestamp: "2026-06-12T01:30:00Z"
sequence: 8
---

## Human

(After PR #607 merged.) Do all the deferred arrange follow-ups in a new
PR: rotation, Z-axis drag, group-centroid transforms, snap-to-grid.

## Assistant

## Decisions

**Rotation: per-engine `.rotate([rx,ry,rz])` codegen modelled on `.scale`.**
For JS/BREP, `setPartRotateJs` inserts the call BEFORE any trailing
`.translate(…)` so the pivot is the part's origin (so it rotates in place at
its world position). For SCAD, `setPartRotateScad` wraps with
`rotate([…])` AFTER any leading `translate([…])` — SCAD's right-to-left
application order gives the same in-place-at-position result. Both
compound additively with an existing leading rotate (Tinkercad-style
"add 30°" semantics) rather than stacking calls. Voxel rotation is
rejected with a warn toast — lattice quantization makes arbitrary angles
unfaithful, and snap-to-90° voxel rotation can come later.

**Z-axis drag: alt-held during drag builds a vertical plane facing the
camera through the pickup point.** The plane normal is the camera-to-pivot
direction flattened onto XY. We still only consume the Z component of the
hit, but the camera-aware orientation keeps the part under the cursor as
the user orbits. Tinkercad-feel "lift up" gesture.

**Group-centroid transforms (resize + rotate).** When 2+ are selected,
`applyResize` and `applyRotate` snapshot the pre-transform centres and
compute the group centroid (union-of-bboxes midpoint) BEFORE editing
any code. After the per-part code edit (which scales/rotates each part
around its own centre, leaving its centre fixed), a follow-up
`writePartTranslateDelta` per part spreads/swings the parts around the
shared pivot. Two pure-leaf helpers in arrangeMath.ts:
`groupCentroidScaleDelta` (anisotropic, all axes) and
`groupCentroidRotateZDelta` (Z plane only — arbitrary 3D rotation around
an arbitrary 3D pivot is rarely what a CAD user wants). Both wrapped in
the same recordOperation so a group resize/rotate is one Ctrl-Z step.

**Snap-to-grid: round every per-engine translate delta.** When the panel
toggle is on, `writePartTranslateDelta` rounds the JS/SCAD effective
delta to whole units; voxel already snaps. Affects drag commits, the
Align spread, and the new Group-centroid rotate/scale spread —
everything that flows through the shared writeback path. Module-level
`snapToGrid` + `snapToGridCheckbox` (for API/UI sync) mirror the
`autoCombine` pattern.

**Parser now accepts a single trailing `.rotate([…]).translate([…])`
chain.** Hand-written code like `Manifold.cube([10,10,10]).rotate([0,0,30]).translate([5,0,0])`
parses to a cube spec (size + position; bbox is the un-rotated AABB, which
over-estimates the footprint but is safe). The controller's
`setPartRotateJs` compounds onto the existing `.rotate` rather than
stacking, so iterated rotates round-trip correctly. Updated the old
"chained transforms → null" test to reflect the new contract;
multi-method chains beyond rotate-translate still return null.

**API parity, mirrored 1:1 with the new panel rows.** Added
`partwright.rotateSelection([rx,ry,rz])`, `setSnapToGrid(on)` /
`getSnapToGrid()`. Same `{ok, reason?}` return shape as the other
selection ops. Documented in `public/ai.md` under the `## Arrange mode`
section's new "Drag along Z" / "Group centroid" / "Snap-to-grid"
paragraphs.

## Tests

- 14 new codegen + math units (setPartRotateJs, setPartRotateScad,
  groupCentroid, groupCentroidScaleDelta, groupCentroidRotateZDelta).
- 3 new palette e2e: API rotateSelection writes `.rotate` before
  `.translate`; group-centroid scale spreads two parts apart from origin;
  setSnapToGrid rounds drag commits to integers.
- All 180 codegen + 21 palette e2e + 1252 unit tests green; typecheck +
  acyclic deps + lint:consistency / lint:deadcode clean.

## Manual verification

Console smoke: two cubes at ±10 on X, both selected →
`partwright.rotateSelection([0,0,45])` rotates each by 45° AND swings
both around the group centroid (visible in screenshots).
The code shows `.rotate([0, 0, 45]).translate([-…, 0, 0])` on each part,
and Undo is enabled (one undo step for the whole group rotate).

## What this PR does NOT do (own follow-ups, called out in PR description)

- **Rotation handles in the viewport** — Tinkercad has 3 ring gizmos; we
  ship numeric inputs only. The drag-handle UX is a deeper viewport
  refactor (and most CAD agents drive via the API anyway).
- **Voxel snap-to-90° rotation** — explicitly rejected with a toast.
- **Rotate from arrange-drag** — drag is still translate-only.
