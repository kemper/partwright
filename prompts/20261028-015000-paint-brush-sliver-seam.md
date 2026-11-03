---
session: "fe6e04b5"
timestamp: "2026-10-28T01:50:00Z"
---

## Human

Asked how to make the paintbrush less dependent on the surface normal under
the cursor on complex models (view-aligned brush, sphere brush, what other apps
do). After trying the suggested workaround (smooth edges off + wrap tolerance
180°, i.e. the projection brush) on a figure: "That 180 test is close. One
problem is that I see these black lines as artifacts like the painting can't
fully paint the 'seam' of the object. I'm painting away black with red and
still see a fine black line I can't get at." [Attached: close-up of a red
painted area with a thin dark hairline, with tiny ticks, along a former
boundary.]

## Assistant

## Key decisions

**Root cause**: the projection brush collects triangles by reading back an
offscreen triangle-id buffer under the brush disk. Slivers narrower than a
pixel (the fans a smooth-edge or part-boundary cut leaves along a seam) often
cover no pixel centre, so they are never collected; the antialiased viewport
still draws them as a faint line of the old colour. Reproduced with a slab
whose top face carries a seam of 120 short 0.01-wide sliver quads: a stroke
across it painted 2–3 of the slivers under the brush, leaving a visible line.

**Fix**: after the pixel readback, grow the footprint across mesh edges into
neighbouring triangles that are thinner than `ui.paintBrushSliverPx` (default
1.5 px, converted to mesh units at the hit depth) and have a vertex or centroid
inside the brush disk, following chains of slivers. Thinness is measured in
world space (2·area / longest edge), not projected, so a normal-shaped face
seen edge-on at a silhouette is never pulled in. Pure helper in
`src/color/thinTriangles.ts` (unit-tested); wired in `projectionPaint.ts`.
GPU alternatives (conservative raster, an edge-line id pass) were rejected:
WebGL2 has no conservative rasterization, and a line pass fights depth with
the triangle pass.

**Scope**: only the projection (smooth-edges-off) brush; the smooth brush
resolves by analytic footprint on centroids and has no pixel sampling. The
alignment/sphere-brush ideas from the first message are not in this change.
