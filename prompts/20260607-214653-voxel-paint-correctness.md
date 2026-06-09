---
session: "a7f3c2"
timestamp: "2026-06-07T21:46:53Z"
sequence: 2
---

## Human

Pre-production audit follow-up: "fix them and group the prs however you think
is most appropriate." This PR collects the voxel + paint correctness findings.

## Assistant

## Key decisions

**Voxel `rotate()` one-voxel pivot bug** (`grid.ts`): a voxel at integer coord
`n` owns the cube `[n, n+1]`, so its centre is at `n+0.5`. `rotate()` applied the
rotation matrix to the min-corner directly, which is equivalent to pivoting about
`(−0.5,−0.5,−0.5)` — every non-identity 90°/180° rotation shifted the solid by a
voxel. The existing "4×90° round-trips" test passed only because the shift
cancels at 360°, masking it. Fixed by rotating cube centres about the origin and
mapping back to the min-corner (`round(rot(n+0.5) − 0.5)`), the same reasoning
`mirror()` already uses (`n → −1−n`). Updated the three rotate unit tests to the
correct target cells (they previously asserted the buggy results). Verified no
example/catalog model calls `v.rotate()` with 90° steps, so nothing shifts.
Also documented that a stored `smooth({ lockBox })` is in voxel coords and isn't
remapped by rotate (set surfacing after transforms), and range-guarded `get()`
to match `has()`.

**Voxel Studio outside modeExclusion** (`voxelPaint.ts` + the mesh/annotate
tools): the studio attaches a capture-phase pointer handler exactly like mesh
paint but was separated from paint/imagePaint only by UI visibility — and the AI
API can drive either regardless of the active language, so two handlers could
fight over the canvas. Added `'voxelStudio'` to `ExclusiveMode`, registered the
studio's deactivator, had `activate()` tear down the mesh-paint + annotate
siblings, and had those siblings call `deactivateMode('voxelStudio')` on
activate. All through the modeExclusion leaf — no mode imports another.

**imagePaintUI back-edge** (`imagePaintUI.ts`): it read `getCurrentMesh`
directly from `paintMode` instead of the `paintAccessors` leaf the drag tools
use — a latent cycle edge. Switched to the leaf.

**paintPreview cylinder `topOnly`** (`main.ts`): the dry-run cylinder path passed
`normalCone` straight through, with no `topOnly`, so it couldn't reproduce a
`paintInCylinder({ topOnly: true })` selection and over-reported triangles. Added
`topOnly` to the preview opts and routed it through `resolvePaintCone`, matching
the commit path.
