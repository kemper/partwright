---
session: "inverse-cad"
timestamp: "2026-07-02T06:00:00Z"
model: claude-opus-4-7
sequence: 4
---

## Human

The v1 sweep is "almost all terrible" — bodies need cylinder connectors,
everything sits flat on the build plate, corners are rounded/chamfered.

## Assistant

## Key decisions

**Delegated 4 worst-offender parts to `model-sculpt` subagents in parallel**
(chest, thigh, hip/shoulder bridge, upper arm) with tight briefs about the
missing constraints (flat-print orientation, cylinder connectors, rounded
edges). All 4 converged well under target:
- chest: 2.67 → 0.54 mm
- thigh: 3.68 → 0.34 mm
- hip/shoulder: 1.60 → 0.45 mm
- upper arm: 2.49 → 0.36 mm

**Every subagent found the same dominant systematic error: the target STLs
are NOT centered on the origin.** They sit flat on the build plate (Z from
0 to 5.5, not ±2.75) and have significant Y-offset (chest at Y=+10, thigh
at Y=+9.75, upper arm at Y=+5.75). My hand-iterated v1 candidates all
assumed a centered bbox → a rigid translation dominated the chamfer error
regardless of feature accuracy.

**Patched all 17 remaining v1 candidates with a single `.translate(realCenter)`
wrapping the return.** Measured target centers with the existing
`scripts/inverse-cad/stl.mjs` bbox helper, generated `-p1.js` variants for
each candidate, and updated `sweep.mjs`. The one-line fix dropped:
- waist: 1.54 → 0.44 (3.5×)
- abdomen: 1.80 → 0.52 (3.5×)
- shin: 3.74 → 0.69 (5.4×)
- forearm: 2.31 → 0.72 (3.2×)
- clavicle: 1.24 → 0.56 (2.2×)
- knee/elbow: 1.57 → 0.80 (2×)
- head: 1.46 → 0.79
- adapter_stand: 1.36 → 0.74
- hands: 1.2-1.6 → 0.8-1.5

**Full sweep after fix: mean chamfer 0.70 mm (was 1.74), worst 1.53 mm
(hand_open_right, was 3.74).**

## Two other bugs the subagents surfaced

- **`CrossSection.extrude(depth, ..., 1)` silently zeroes Y-taper.** The
  `scaleTop` argument must be a `[sx, sy]` pair; a scalar `1` produces a
  pyramid, not a straight-walled extrusion. Every candidate that used this
  was building the wrong shape.
- **`CrossSection.hull(otherShape)` doesn't exist** the way one might guess;
  the API is `CrossSection.hull()` on a union. Rounded rectangles come from
  `.offset(r, 'Round', 24)` instead — that's the tool the subagents settled on.

## What I deliberately did NOT do yet

- Send subagents for the second wave (head/ankle/forearm/shin/knee-elbow +
  6 hands). Positioning fix was the free lunch; getting these under 0.4 mm
  will need real rewrites, and I want the user's go-ahead first.
- Rebuild `src/geometry/dummy13.ts`. The correct architecture (bodies=balls,
  bridges=sockets, chest is mixed, everything flat-on-plate) is now known,
  but codifying it should happen AFTER the second subagent wave polishes
  the remaining parts.
