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
