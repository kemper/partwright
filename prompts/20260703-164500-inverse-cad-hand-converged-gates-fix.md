---
session: "inverse-cad"
timestamp: "2026-07-03T16:45:00Z"
model: claude-fable-5
sequence: 18
---

## Human

(continuation — wave 1 of the v2 re-convergence)

## Assistant

## Key decisions

**hand_grip_left — v1's "hardest class" — converged 6/6 MUST at chamfer
0.028 in 6 turns.** The v1 plateau was never organic-shape difficulty; it
was three hidden structural/tooling issues the delta feedback exposed:
(1) stacked band extrusions meeting at an exact shared plane never weld
(float drift → silent shell decomposition → garbage genus), fixed by a
0.01mm band overlap; (2) the target carries two tiny internal debris
shells that owned both the components gate and the 0.9mm hausdorff tail —
reproduced as internal voids; (3) bootstrap's band merge is too coarse for
organic parts — a uniform fine 0.4mm slice loop with ledge-snapped edges
was the right scaffold. Per-finger domes were never needed.

**Fixed a real gates.mjs bug the agent reported (and correctly did not
patch itself): genus convention mismatch on multi-shell targets.** Engine
genus = 1 − χ_total/2; target profile genus = components − χ/2. A faithful
reconstruction of a multi-shell target could not pass. gates.mjs now
converts the target profile to the engine convention
(1 − components + genus) before comparing; unit test covers the 3-shell
case and the single-shell regression.

**PLAYBOOK ratchet**: epsilon-weld trap, bootstrap-too-coarse trap,
split-first/debris-shell trap, ledge-snap tactic (§5.13).
