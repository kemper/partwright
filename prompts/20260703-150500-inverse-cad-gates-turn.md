---
session: "inverse-cad"
timestamp: "2026-07-03T15:05:00Z"
model: claude-fable-5
sequence: 9
---

## Human

(continuation — v2 framework build)

## Assistant

## Key decisions

**gates.mjs** — machine-checkable "done". MUST: hausdorff P99 ≤ 0.4mm,
hausdorff max ≤ 0.8mm, volume IoU ≥ 0.95, worst finding ≤ 4mm³, topology
(genus+components) match, volume ratio ±2%. Chamfer demoted to advisory.
**IoU threshold calibrated empirically, not guessed**: the ankle vs itself
translated 0.05mm (invisible) scores IoU 0.9555; 0.1mm → 0.9027 — thin
walls make IoU harsh, so 0.95 is the same-shape/registration-noise boundary.

**turn.mjs** — the loop protocol. `init` caches a target profile
(bbox/volume/PCA/genus); each turn runs the candidate through the real
engine, computes exact distance + voxel findings + gates, writes
attempts/NNN artifacts, updates state.json, and enforces non-regression on
the best/ pointer (the tool owns it, not agent discipline). Feedback is a
text digest: gate table, findings with per-finding suggested probe
commands, phase (place→silhouette→topology→features→tune→done) + guidance.

**Live demo on the ankle closed the loop without visual guessing:**
- Turn 0 (deterministic trace): the "converged" v1-style candidate FAILS
  4/6 MUST gates — 6.7% excess volume; finding F1 = 10.3mm³ excess at part
  center. The old chamfer metric scored this 0.066 and called it done.
- probe fit --near F1 → sphere r=2.896 @ [0,0,2.5], 98.6% inliers (the
  ball-socket cavity the flat trace filled in).
- Turn 3: subtract the probed sphere → 5/6 MUST, score 1.02→0.48, phase
  tune. One probe + one edit. The remaining IoU gap is the target's edge
  chamfers.
- Turns 1-2 were no-op edits (my patch bugs) — the TIE verdict caught both
  instantly. Non-regression + verdict-vs-best is real defect detection.

**trace2code zBase float-noise fix**: |zBase| < 1e-9 emits 0 (was emitting
`.translate([0, 0, -1.15e-17])`, which also broke string-match patches).
