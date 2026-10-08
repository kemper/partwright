---
session: "inverse-cad"
timestamp: "2026-07-03T15:45:00Z"
model: claude-fable-5
sequence: 14
---

## Human

(continuation — v2 framework build; implementer subagent delivered the
deterministic bootstrap)

## Assistant

## Key decisions

**bootstrap.mjs — deterministic first candidates.** Axis pick by
contour-stability prismaticScore, band merging (pure exported mergeBands
with 8 unit tests), per-band circle-fit→cylinder vs traced-polygon
classification, holes subtracted per band (genus-correct at turn 0),
STAIRCASED flags on unstable bands, and a self-score via eval.

Acceptance measured across the corpus: ankle 0.057, knee/elbow 0.075,
thigh 0.112, hand_open 0.221, adapter_stand 0.294, hips 0.302 (correctly
flagged 5/6 bands staircased) — median 0.167 vs the ≤0.35 bar; all 21
corpus parts render.

**Accepted the subagent's flagged deviation**: prefer-Z tie-break widened
±0.05 → ±0.10, justified with data (the band-similarity heuristic is
biased against the thin print axis; forcing Z on ankle/knee-elbow scored
~4× better, while genuinely non-Z parts win by > 0.2 and are unaffected).
