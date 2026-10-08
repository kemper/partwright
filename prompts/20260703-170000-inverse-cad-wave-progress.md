---
session: "inverse-cad"
timestamp: "2026-07-03T17:00:00Z"
model: claude-fable-5
sequence: 19
---

## Human

(continuation — v2 re-convergence waves)

## Assistant

## Key decisions

**5/21 parts converged all-MUST-gates-green**: adapter_stand (chamfer
0.0008), frame_ankle (0.0026), frame_thigh (0.0013, genus 3/3, ZERO
findings), hand_grip_left (0.028), hand_grip_right (0.028 — via §5.14
mirror-the-sibling, 2 turns).

**frame_thigh vindicated the whole approach**: v1's candidate had the
architecture wrong at BOTH ends (spool + through-window + C-clip cavity,
not "ball ends") — its >2mm defect was invisible to v1's metric and
obvious to the findings list. Nothing was inherited from v1.

**Gate-change consistency case handled**: hand_grip_left's stored best
predated the genus-convention fix and passed only under stale bookkeeping;
promoted the gate-valid box-void variant (= right's converged candidate
minus its mirror) to best/ manually with a state.json note. Lesson for the
framework: when gates.mjs changes, stored bests need re-validation — noted
in the PLAYBOOK trap list via the torus-void obsolescence entry.

**PLAYBOOK ratchet round 3**: §5.14 mirror shortcut, §5.15 locate
hausdorff-max explicitly, §5.16 tilted-face chamfers, §5.17
prisms-along-different-axes, plus traps (cylinder r=0, subtract voids from
the assembled body LAST, hull-slab flares, box-not-torus voids).

Pool refilled: shin (with thigh's sibling notes) + hand_fist_left (with
grip recipe); knee_elbow + hip_shoulder still running.
