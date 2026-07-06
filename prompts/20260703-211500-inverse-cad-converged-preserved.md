---
session: "inverse-cad"
timestamp: "2026-07-03T21:15:00Z"
model: claude-fable-5
sequence: 31
---

## Human

(continuation — wrap-up after 21/21 convergence)

## Assistant

## Key decisions

**Preserved the 21 converged reconstructions in the tracked tree**
(`scripts/inverse-cad/converged/dummy13/<part>/{candidate.js, metrics.json,
notes.md, state.json}` + summary README with the full gate table). The
originals live under gitignored `.plans/` on an ephemeral container —
without this commit the entire convergence result would evaporate at
container reclamation. The notes.md files carry the measured dimensions
and design-intent findings that Phase C's `src/geometry/dummy13.ts`
rebuild will be written from.

Independently re-verified all 21 via fresh eval runs (mean chamfer
0.0083mm, worst 0.0283 — matches the state files) and delivered the final
6-view gallery to the user in 4 labeled batches.
