---
session: "01TLwb"
timestamp: "2026-06-08T15:05:00Z"
---

## Human

When opening the voxel studio, dragging/clicking on the model should not rotate
the interactive view, the way the paint menu already behaves. On investigation
the real trigger was the **voxel delete tool**. The user also asked for the
delete tool to show a brush-size preview shape so they can tell what they're
about to delete. (A third request — keeping voxel colours after a regular paint
operation — is being investigated separately and is not part of this change.)

## Assistant

## Key decisions

**Diagnosed the "voxel studio rotates" report as the delete tool carving holes,
not a missing suppressor.** The studio already vetoed OrbitControls for
on-model presses exactly like mesh paint (`isPointerOverModel`). Reproduced with
a real-mouse Playwright drag: the default brush never rotates, but the delete
tool does — because deleting punches holes through the mesh, and a *surface*
raycast misses over a hole, so the press falls through to OrbitControls. Paint
never hits this because painting can't remove geometry.

**Fixed it with a bounds-based veto for the studio, not a surface-based one.**
Added `isPointerWithinModelBounds` to the viewport (raycasts the model's AABB via
`ray.intersectsBox`) and switched the voxel studio's pointer suppressor to it.
Now any press within the model's footprint — including into a just-carved hole —
counts as edit-intent and never rotates, while a drag that starts clearly
outside the model still orbits. Surface-based veto would have required tracking a
"pre-edit" silhouette; bounds is a simple, robust proxy. Trade-off: orbiting now
needs a drag from outside the bounding box rather than just outside the
silhouette — acceptable in an editing context, and verified that off-model orbit
still works.

**Added a brush-footprint hover preview for the brush tools.** A single
`InstancedMesh` of slightly-oversized unit cubes (added to the scene like the
mesh-paint brush ring) highlights the cells the active tool would touch at the
hovered voxel: occupied cells for paint/remove, empty cells for add. Tinted red
for delete ("this gets removed"), the paint colour otherwise. It follows the
cursor (hover *and* during a stroke off one shared raycast), retints/resizes
live when the tool or brush size/shape changes, clears on the press that commits
the edit and on pointer-leave, and is disposed on deactivate. `onPointerMove`
was previously stroke-only; it now also drives the hover preview.

**Verification.** Repro'd the rotation bug and confirmed the fix with real-mouse
drags (in-hole drag: 52° → 0°; off-model drag still ~85°). Screenshotted the
delete (red sphere) and paint (cube) previews. Added
`tests/voxel-studio-camera.spec.ts` as the regression guard. Full unit tier +
all voxel e2e specs pass.
