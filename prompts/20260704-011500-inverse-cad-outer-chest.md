---
session: "inverse-cad"
timestamp: "2026-07-04T01:15:00Z"
model: claude-fable-5
sequence: 38
---

## Human

(continuation — armor waves)

## Assistant

## Key decisions

**6/16 armor — armor_outer_chest (biggest piece, 18×15×20mm, 17.8k tris)
converged in ONE authored turn** at chamfer 0.0045, 6/6+2/2. The §5.22
volume test (29% of bbox ≪ the ~50% plate signature) correctly routed it
to the §5.25 levelSet recipe; 138 sections + 5 straddle-paired ledges;
the waist generator transferred verbatim.

Ratchets: Σ|signedArea| ledge-scan trap (raw signed-area scans show
phantom ±100mm² sign-flip "ledges"; mirror-twin equal-and-opposite areas
= orientation noise), straddle-pair blend-zone refinement, and routing
guidance appended to §5.25.

In flight: armor thigh, forearm, hip + hands levelSet agent.
