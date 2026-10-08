---
session: "inverse-cad"
timestamp: "2026-07-03T14:45:00Z"
model: claude-fable-5
sequence: 7
---

## Human

Switched the session to Fable 5. Wants the task to succeed at high quality and
generically ("a high quality generic tool/framework"), with Opus 4.8 subagents
ultimately able to run it. Asked for ideation subagents on the problem space.
Key critique: "It still feels like you're guessing at the parts visually rather
than comparing the delta between meshes and I'm seeing substantially different
meshes based on the preview images." Also asked to reconcile the stale PR #879
/ issue #878 task lists.

## Assistant

## Key decisions

**The v1 metric was the root cause — measured, not assumed.** Ideation flagged
that `distance.mjs` computes nearest-neighbor distance between two independent
5000-point *samplings* (point→point, not point→surface). Verified empirically:
identical meshes score chamfer 0.13–0.18 mm, hausdorff up to 0.69 mm. The v1
sweep's "mean 0.42 mm" was ~2× the noise floor — the number carried almost no
information, which is exactly why agents fell back to eyeballing PNGs.

**Two ideation subagents produced the v2 design** (metrics side + agent-loop
side), synthesized into issue #878:
- exact signed point→surface distance (BVH + closest-point-on-triangle +
  ray-parity sign) — noise floor ~1e-7 verified
- voxel symmetric-difference findings: located, signed, sized error blobs with
  thin-skin/compact-feature classification (routes numeric-vs-structural fixes)
- probe.mjs target interrogation ("measure, never estimate"), turn.mjs
  protocol with non-regressing best pointer, deterministic bootstrap,
  calibrated visual-identity gates, living PLAYBOOK.md, optimizer

**Re-scored all 21 candidates with the exact metric**: true state is mean
chamfer 0.336, but hausdorff up to **3.35 mm** (hands), 1.5–2.8 mm on most
bodies — whole features wrong, confirming the user's eye over the old numbers.
Only ankle/knee-elbow/stand/hips are genuinely converged (haus < 0.65).

**Half-open edge-ownership parity fix in voxelizeMesh** (finished inline after
the implementer subagent was killed repeatedly by an API incident): a column
through a face diagonal registered crossings in BOTH coplanar triangles,
yielding pairs like z=0,0,10,10 that fill nothing — an EVEN-parity failure the
odd-count fixups can't see. Fix: strict-inside test with a lexicographic
directed-edge tie-break so a boundary point is owned by exactly one triangle
(the two sharers traverse the edge in opposite directions). 10 mm cube now
voxelizes to 1000±2% mm³; self-IoU = 1.0 exactly.

## Deviations

- Subagent infra had a persistent 500 incident mid-build; surfaceDistance and
  voxelDiff landed ~95% complete from their agents and were finished/verified
  inline. probe/trace2code moved fully inline (next commit).
