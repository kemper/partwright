---
date: 2026-06-04
branch: claude/friendly-lamport-Bdf5m
pr: 368
files_changed:
  - src/color/imagePaint.ts
---

## Human

Still seeing clipping on low polygon models — need better mesh subdivision logic.

## Assistant

Clipping root cause: `stampImageOntoMesh` (imagePaint.ts) colors a triangle only when its centroid lands inside the stamp square. After subdivision, boundary triangles whose child fell outside `overlapsStamp` stop refining early. Those stopped children can be large enough that their centroid falls just outside the stamp square even though the triangle body overlaps it → the triangle isn't colored → visible gap = "clipping."

The comment in the old code warned against a vertex-based test because "clamping" to the stamp edge often sampled the dark border pixel and flooded a large area. The fix avoids that problem by never clamping: instead of clamping, it finds the vertex (of the 3 triangle vertices) whose stamp UV is closest to the stamp centre (smallest `max(|u|, |v|)`) and lies inside the square. If no vertex is inside, the triangle is skipped as before. This way the sampled pixel is always a real in-stamp pixel (not a border pixel), and the `bgMask` check already filters out transparent background pixels regardless.

Decision: subdivision depth increase was considered (changing `stampDetail`) but wouldn't fix the geometric gap — subdivision stops at the stamp square boundary by design, leaving coarse outer children. The vertex-fallback coloring addresses it directly without adding subdivision cost.
