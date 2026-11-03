---
session: "016A4CDA"
timestamp: "2026-10-26T20:35:00Z"
tools: [subagent]
---

## Human

Shared tooling feedback from an in-app AI agent that turned a 946k-triangle
imported head sculpt into a wearable mask. Its top ask: "A real 3D offset or
shell tool. Hollowing a sculpt to a uniform wall took three failed attempts…
A built-in `api.shell(m, {thickness})` or `api.offset(m, d)` would have
replaced all of it." The feedback also asked for log capture, reference
geometry in renders, annotated sections, a thickness map, guidance for heavy
imports, and a head proxy.

## Assistant

## Key decisions

**Scope**: An audit subagent checked every feedback item against the code.
All seven items went into tracking issue kemper/partwright#1143. This PR does
only the shell/offset item, the one that cost the agent the most.

**Shell keeps the input surface exact**: `shell(inside)` is
`m.subtract(offset(m, -t))`, not a single levelSet of `max(f, -(f+t))`. Only
the new inner wall is remeshed. The sculpted outer surface keeps its own
tessellation and `api.label` parts, and for a mask the face detail is what
matters.

**Exact distances on one side only**: The offset reuses `round`'s pipeline
(raster → EDT → exact nearest-triangle distances on a band → levelSet). The
band covers only the side the new surface lies on, which halves the BVH
queries. Profiled at ~925k triangles: ~15 s total (exact distances 5.4 s,
levelSet 3.4 s, boolean 3.7 s). The agent reported 30–70 s per run plus 80
hand-written lines.

**Open masks stay a boolean**: There is no `open:` option. The shell returns
a closed hollow solid, and the docs show cutting the back off with a box.
That keeps the API small and lets the user choose where the opening goes.

## Assistant

## Review follow-up

**Band chosen by triangle distance, not raster distance**: The review
subagent reproduced a real defect. A fin or slot thinner than a lattice
voxel never flips the occupancy raster, so the raster-based band skipped the
samples next to it. Growing the solid lost the fin, and an inside shell
broke open into the slot. That second case is the mask failure mode: lip
lines, eyelids and nostrils. The band now uses the EDT from samples the
triangles pass through (the way `nearScope` works), and the side comes from
the exact per-sample `occ`. Regression tests cover the fin and 0.3/0.5/3-wide
slots.

**Padding and limits**: An inward offset no longer pads the lattice by 2·d,
which made a capped lattice coarser. The ~925k-triangle shell went from 15 s
to 12 s. The too-small error now names the parameter the caller passed
(`distance`/`thickness`). The docs give the measured minimum (≈ 1.5 × span ÷
resolution: a 0.3 clearance works up to ~37 units at 192 and ~63 at 320).
The docs also spell out how the SDF `node.shell` and `BREP.shell`
conventions differ from `api.shell`.

## Assistant

Added a 4-Ls retro for this PR (retros/inbox/20261026-210500-mesh-shell-offset.md).
