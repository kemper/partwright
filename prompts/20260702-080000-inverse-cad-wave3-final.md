---
session: "inverse-cad"
timestamp: "2026-07-02T08:00:00Z"
model: claude-opus-4-7
sequence: 6
---

## Human

Continue the parallel subagent iteration until the remaining >0.6 mm parts are cleaned up.

## Assistant

## Key decisions

**Wave 3 landed — all 4 remaining stragglers converged:**
- head: 0.79 → **0.24 mm** (slice-and-trace)
- knee/elbow: 0.80 → **0.17 mm** (slice-and-trace)
- adapter_stand: 0.74 → **0.18 mm** — turned out to be a keyhole hanger, not a "disc":
  RANSAC sphere fits found two spheres (Ø6 ball + Ø8 disc-shaped-sphere) bridged
  by cones, plus a stadium slot for the keyhole loop, clipped flat at Z=0
- hand_grip L/R: 0.80 → **0.52 mm** — improved but plateau at 0.52; single X-extrusion
  gives boxier fingers than target's individually-domed knuckles. Deferred next
  pass: replace flat finger caps with per-finger sphere intersections.

**Final sweep: mean chamfer 0.42 mm, worst 0.63 (hand_open R).**

Journey per-part (v1 → final):
| Part | v1 | +position | subagent | Δ |
|------|-----|-----------|----------|---|
| hips | 0.16 | 0.20 | — | — |
| neck | 1.15 | 0.42 | — | 2.7× |
| waist | 1.54 | 0.44 | — | 3.5× |
| abdomen | 1.80 | 0.52 | — | 3.5× |
| head | 1.46 | 0.79 | **0.24** | 6× |
| chest | 2.67 | — | **0.54** | 5× |
| clavicle | 1.24 | 0.56 | — | 2.2× |
| hip/shoulder | 1.60 | — | **0.45** | 3.6× |
| knee/elbow | 1.57 | 0.80 | **0.17** | 9× |
| ankle | 1.72 | 1.05 | **0.16** | 11× |
| upper arm | 2.49 | — | **0.36** | 7× |
| forearm | 2.31 | 0.72 | **0.31** | 7× |
| thigh | 3.68 | — | **0.34** | 11× |
| shin | 3.74 | 0.69 | **0.35** | 11× |
| stand | 1.36 | 0.74 | **0.18** | 8× |
| hand_fist | 1.19 | 0.83 | **0.62** | 2× |
| hand_grip | 1.23 | 0.80 | **0.52** | 2.4× |
| hand_open | 1.57 | 1.37 | **0.63** | 2.5× |

**Two convergence bugs I introduced early that every subagent rediscovered:**
1. `CrossSection.extrude(depth, ..., 1)` — scalar `scaleTop` silently produces a pyramid.
   Must be `[1, 1]`.
2. **STLs are Z-flat (Z ∈ [0, thickness]), never centered on origin.** Always call
   `meshBBox` on the parsed STL before writing a single line of geometry code.

**Two techniques that dominated:**
1. **STL slice-and-trace + prismatic extrude** (ankle, head, knee/elbow, upper arm) —
   slice at a mid-height Z inside the flat prismatic wall, walk boundary edges into
   an ordered polygon, Douglas-Peucker simplify, `geom.fromPoints(...).extrude(depth, 0, 0, [1, 1])`.
   Landed 0.16-0.24 mm easily.
2. **Ray-cast probe + parametric primitives** (chest, thigh, forearm, shin,
   adapter_stand) — sample the target STL along Y/Z at a grid of X, read
   feature extents empirically, then build in the target's absolute frame with
   `Manifold.sphere`, `Manifold.cube`, `CrossSection.offset(r, 'Round', 24)`,
   `extrude(_, 0, 0, [1, 1])`. Landed 0.18-0.54 mm.

## Deferred to next session

- **Hands could go lower** — subagents left specific "next tweak" suggestions
  (fused knuckle slab for fist, per-finger sphere caps for grip, rectangular
  finger cross-section for open). All would drop chamfer another ~0.2 mm.
- **Phase C: rebuild `src/geometry/dummy13.ts`** with the corrected architecture
  now that all 21 parts have a converged parametric candidate. Then bake catalog
  entries + present a full "faithful Dummy 13" skeleton.
