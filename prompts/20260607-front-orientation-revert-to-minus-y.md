---
date: 2026-06-07
branch: claude/model-direction-import-issue-e7hgx
files_changed:
  - src/renderer/multiview.ts
  - src/renderer/viewport.ts
  - src/main.ts
  - public/ai.md
  - public/ai/voxel.md
---

## Human

"When I export a 3MF and import into Bambu Studio, my models often face the
back, as if the direction is reversed." Then, on investigation: "I've noticed
the modeling AI producing models facing away from the default interactive view.
I had some past change to the initial Y direction — find the commit, tell me why
we did it, should I reverse it?" Decision after discussion: switch the front
convention back to −Y, make all view/camera logic consistent with it, and add
terse top-level ai.md guidance so agents model the right way round.

## Assistant

**Root cause.** Two same-session commits (May 30) disagreed. `e2e8d72` correctly
documented **Front = −Y** (the Blender/OpenSCAD/slicer standard) and taught
agents that. Minutes later `207a502` flipped the convention to **+Y** on the
preference argument that "+Y = forward feels intuitive" — and applied it
*incompletely*: it flipped the boot camera, the multiview "Front" tile (what the
AI sees), the 4-iso composite, and ai.md, but **left `frameModel()`** — the
camera the user actually looks through once a model loads — on −Y. Net result:
the AI was told front = +Y and built models facing +Y, while the interactive
viewport (and every slicer's build plate, where −Y is the front edge) views from
−Y. So AI models faced away in the viewport *and* faced the back of the Bambu
plate — same root cause, two symptoms. The flip also silently broke the
`getCameraState()` ⇄ `buildViewCamera()` round-trip used by `setThumbnailCamera`
(getCameraState was never flipped, so its `atan2(dir.x, -dir.y)` only matches the
−Y math).

**Fix — restore −Y everywhere, keeping the iso corner physically identical:**

- `multiview.ts`: reverted `cy = -cos(azimuth)` (azimuth 0 → camera at −Y, so the
  "Front" tile shows the −Y face and finally matches the viewport); reverted the
  4-iso `VIEWS` Y-signs so the Front/Back labels are physically correct; reverted
  the azimuth comment.
- `multiview.ts`: iso `STANDARD_VIEWS` azimuth **135 → 45**. This is the key
  subtlety: under the +Y math, `77684d3` had moved iso to 135 to land on the
  non-mirrored **(+X, −Y)** corner. Under the reverted −Y math, azimuth **45**
  lands on that *same physical corner*. So every catalog/gallery thumbnail (live-
  rendered from `STANDARD_VIEWS.iso`, no baked PNGs) renders from an identical
  viewpoint — **zero thumbnail regression** — while +X stays screen-right.
- `viewport.ts`: boot camera `[15,15,15] → [15,-15,15]` (matches the −Y
  `frameModel`, which was the untouched holdout).
- `main.ts`, `public/ai.md`, `public/ai/voxel.md`: doc/comment text and the
  `setThumbnailCamera` azimuth legend back to −Y; voxel.md default azimuth 135→45.
  ai.md keeps it terse — the top-level coordinate line states Front = −Y, notes it
  is also the slicer build-plate front (so a −Y model exports facing forward), and
  the existing "wrong side" mistake bullet reinforces it.

**Deliberately not touched.** `getCameraState`, the CLI preview
(`scripts/cli/preview.mjs`, already −Y), and the gizmo (axis letters, convention-
agnostic) were already correct for −Y. Catalog entries that authored "front on
+Y" (~10) were already showing their back under the old regime too (the iso
camera faced −Y/+X even at azimuth 135); since the physical thumbnail camera is
unchanged, they look identical after this change — re-orienting them to the
−Y/+X corner per voxel.md is a separate content cleanup, out of scope here.

**Verification.** `npm run build` + `npm run test:unit` (718) green. A scratch
Playwright spec built a box with a nose on −Y, a bump on +X, a fin on +Z: the
interactive viewport and the `renderView('front')` tile both show the nose facing
the camera with +X on the right; the back tile hides the nose with +X on the
left; the iso tile shows the front-right hero view. Screenshots posted in-session.
