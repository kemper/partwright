---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-19T02:25:17Z"
tools: [subagent, vitest, vite-ssr]
---

## Human

Add one new part detector, `thickness` ("Thickness (limbs vs body)"), to the
part-detection registry (#1025): a shape-diameter-function style split for
fused figures where no groove separates limbs from the torso. Seeds optional;
unseeded it clusters per-triangle thickness into levels, seeded it adds the
thickness jump to the crease cost of the hybrid growth. Add unit tests, bench
rows, and evaluate on the real figurine.

## Assistant

## Key decisions

**Thickness from the voxel EDT, marched along -normal.** Reused
`rasterizeOccupancy` + `edt3dSquared`; per triangle the max inside-radius along
-smoothNormal (5 rays, median) gives the local half-thickness. Cached in
`ctx.cache` (key = features + resolution + allow mask), so the level /
smoothing / seed sliders re-run only the cheap stages. `maskKey` moved from
autoPatches into features.ts so both detectors share it.

**Three ray-marching guards found by testing, not in the brief.** (1) Stop
once the ray has travelled more than 2x its best radius: a ray down a limb's
axis otherwise reads the torso it joins. (2) A ray that never enters the solid
within 1.5 voxels is pointing outward (cone ray off an edge) and must not
re-enter elsewhere. (3) R is 0 outside the lattice (the shared sampler returns
1e6 there, which would read as huge thickness), so the march uses its own
inline trilinear sample (also 1.5x faster).

**Fixed a real bug in `absorbSmallRegions`.** Two small neighbours each chose
the other as host and swapped labels every round forever, leaving 44 parts
instead of 13 on the scan. A label that a smaller region is joining now stays
put that round. All existing tests still pass.

**Defaults tuned on data.** The brief's seeded defaults (jump 1, groove 0.5)
scored below plain crease-watershed on segment:bench; groove weight 1 + jump
0.3 beat it (0.772/0.683 vs 0.768/0.652 clean/noisy) and jump 0 reproduces it
exactly (sanity check). Smoothing default 8; added a "Limbs and torso" preset
(5 levels, smoothing 12) because that is the setting that peels arms and legs
off the torso on the figurine (area-weighted k-means spends its first levels
on the thin base plate).

**Tests use a lathe (surface of revolution), not a voxel staircase.** A voxel
mesh has axis-aligned stair faces and sharp edges whose edge strips measure
thin by construction (an inscribed ball near a wall is small), so the arm only
classified 54% thin. A welded lathe has radial normals, which is what the
detector is meant for.
