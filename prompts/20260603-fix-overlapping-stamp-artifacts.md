---
date: 2026-06-03
branch: claude/friendly-lamport-Bdf5m
pr: 368
files_changed:
  - src/main.ts
  - src/color/imagePaintUI.ts
  - src/color/paintUI.ts
  - src/ui/modeExclusion.ts
---

## Human

After applying multiple overlapping image stamps (smooth=ON), earlier stamps show large flat-colored triangular patches matching coarse mesh triangles. Also requesting: default stamp size → 5, smooth edges default ON, remove background default ON, persist uploaded image across page refreshes.

## Assistant

Two separate bugs contributed to the artifacts:

**Bug 1 — Multi-stamp descriptor remap (imagePaint branch)**
`imagePaint` descriptors store triangle indices from the mesh at stamp creation time (M1 for stamp 1, M2 for stamp 2, etc.). Step 4 of the smooth-stamp callback was routing `imagePaint` into the `resolveDescriptorTriangles` else-branch, which reads `descriptor.entries` through only the most-recent one-step `parentToChildren` map. For stamp 3, this re-resolved M1 indices through the M2→M3 map — completely wrong triangles colored. Fixed by treating `imagePaint` like `triangles`/`byLabel`: directly remap `region.triangles` (always current runtime state) through `parentToChildren`, discarding the stale entries.

**Bug 2 — T-junction supplemental scan**
After stamp N subdivides triangles in its footprint, T-junctions form between the fine (stamp-area) triangles and medium (outer-boundary) triangles adjacent to them. The BFS for stamp N+1 walks via mesh adjacency and cannot cross T-junctions, so medium boundary triangles that fall within the footprint bounds are missed. `stampImageOntoMesh` colors triangles by centroid — a medium triangle with its centroid inside the stamp circle but not in `footprintTris` gets painted at full coarse size, producing large triangular patches.

Fix: after the BFS completes, do a forward O(numTri) scan over all triangles not yet in `visited`. Apply the same back-face and inFootprint checks. Any forward-facing triangle with centroid or vertex inside the footprint bounds gets added to `footprintTris`, ensuring it will be refined before painting.

UI defaults changed in `imagePaintUI.ts`: stamp size 20→5, `stampSmooth` true, `removeBackground` true. Image persistence added via localStorage (JPEG, key `imagePaint_savedImage`), restored on panel init. Circular dependency imagePaintUI↔paintUI broken by routing both through `modeExclusion.ts` (`registerExclusiveMode`/`deactivateMode`).
