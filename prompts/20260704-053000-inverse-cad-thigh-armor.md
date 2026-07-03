---
session: "inverse-cad"
timestamp: "2026-07-04T05:30:00Z"
model: claude-fable-5
sequence: 44
---

## Human

(continuation — armor endgame)

## Assistant

## Key decisions

**14/16 armor — armor_thigh converged at chamfer 0.0010** (6/6+2/2, 4
attempts; attempts 2-3 regressed chasing the mouth chamfer and the
non-regression tool discarded them). Notably it's a FULLY PARAMETRIC CAD
decomposition — the "curved wall" was one analytic R81 arc, levelSet never
needed. The part decode is remarkable: sleeve octagon, tangent scoop,
knee-pivot cluster all referencing one axis, sheared corner prisms.

Ratchets: §5.30-5.33 (sheared corner prisms, shared pivot axis, down-ray
topo map, paired-ray wall thickness) + two §7 traps (rotated-cutter
phantom membrane at cos90°=6e-17 — overshoot coincident planes; hull-slab
diagonal runs to the far OUTER corner).

Remaining: armor_forearm (nudged) + hands levelSet agent.
