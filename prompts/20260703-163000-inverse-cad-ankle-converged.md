---
session: "inverse-cad"
timestamp: "2026-07-03T16:30:00Z"
model: claude-fable-5
sequence: 17
---

## Human

(continuation — wave 1 of the v2 re-convergence)

## Assistant

## Key decisions

**frame_ankle_2x converged: 6/6 MUST + 2/2 SHOULD in 2 turns** — chamfer
0.0026mm, hausdorff max 0.1185mm, IoU 0.9949, volume ratio 1.0004. The
agent replaced the slice-stack with a full CAD decomposition (disk + planar
cuts + mouth wedge through the socket center + traced keyhole + probed
sphere + measured entry cones + exact bevel wedges).

Two gate-design vindications worth recording:
- The "residual edge chamfer" from my earlier analysis was actually TWO
  distinct features — 45° ring bevels AND ~20° conical socket entry
  lead-ins — separable only by measurement (r(z) linear segment).
- Attempt 1's stepped-offset chamfer passed ALL MUST gates but failed the
  advisory area-ratio gate (staircase carries √2× the true face area
  regardless of step count) — the SHOULD layer caught an approximation the
  distance gates cannot see, and the agent acted on it.

**PLAYBOOK ratchet**: tactics §5.10 (socket entry cones), §5.11 (staircase
chamfers fail area not distance; exact wedge recipe), §5.12 (test whether
cut lines pass through feature centers — design intent), and the turn.mjs
candidate-path-resolution trap.
