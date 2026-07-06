---
session: "inverse-cad"
timestamp: "2026-07-03T16:10:00Z"
model: claude-fable-5
sequence: 16
---

## Human

(continuation — wave 1 of the v2 re-convergence)

## Assistant

## Key decisions

**First wave-1 result: adapter_stand converged to near-exactness in ONE
turn** — chamfer 0.0008mm, hausdorff max 0.069mm, 6/6 MUST + 2/2 SHOULD.
The agent spent ~8 probe calls measuring before its first edit, and
residual analysis REJECTED both straight cones and a single fillet arc for
the neck (fit residual 0.03-0.05 vs 0.0002 band noise) in favor of a
traced-polyline revolve. v1 spent a whole subagent session reaching 0.18
chamfer on this part with invisible defects.

**PLAYBOOK ratchet applied** (the between-waves merge protocol working as
designed): two new tactics (§5.8 back-face rays for clipped revolve
profiles, §5.9 residuals decide primitive-vs-polyline) and one trap
(cs.revolve axis convention + winding check) from the agent's return.
