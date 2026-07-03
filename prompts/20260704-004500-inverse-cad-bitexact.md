---
session: "inverse-cad"
timestamp: "2026-07-04T00:45:00Z"
model: claude-fable-5
sequence: 37
---

## Human

(continuation — armor waves)

## Assistant

## Key decisions

**5/16 armor — armor_upper_arm converged BIT-EXACT: chamfer 0.000,
hausdorff 0.000, volume ratio 1.0000, one authored attempt.** The new
ceiling for the framework. Method: facet-census decode (§5.26) — for
low-poly STLs, group triangles by exact (normal, offset) and read every
plane equation directly off the mesh; zero probe fits needed. Plus
convexity-test → hull-of-exact-vertices (§5.27), the armor clip-shell
recipe (§5.28), and reading a faceted bore's radius/segments/phase from
its tangent-plane fan (§5.29 — 144-gon r=3.100, authored exactly).

New §7 trap: Manifold.hull accepts raw [x,y,z] triples — winding-proof
replacement for fromPoints+extrude on convex prisms.

Remaining in flight: armor_thigh, armor_outer_chest, hands levelSet agent.
