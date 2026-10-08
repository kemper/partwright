---
session: "inverse-cad"
timestamp: "2026-07-04T03:20:00Z"
model: claude-fable-5
sequence: 41
---

## Human

(continuation — armor waves)

## Assistant

## Key decisions

**9/16 armor — armor_shin converged** (chamfer 0.0061, 6/6+2/2, 2 turns,
genus 3 reproduced for free by the section interpolation). Its refinement
is ratcheted as §5.25d: clamp the blended SDF to ±(edge/2) so
marching-cubes crossings at flat interior ledges land exactly on-plane —
diagnosed via §5.19c (ray-probing the candidate mesh, not the target).

In flight: armor thigh, forearm, knee+toe, abdomen+head, hands levelSet.
