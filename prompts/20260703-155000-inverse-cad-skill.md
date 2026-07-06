---
session: "inverse-cad"
timestamp: "2026-07-03T15:50:00Z"
model: claude-fable-5
sequence: 15
---

## Human

(continuation — v2 framework build)

## Assistant

## Key decisions

**`.claude/skills/inverse-cad.md`** — the orchestration driver procedure:
splitStl → per-part init/bootstrap/turn-0 → triage by state.json → waves
of ~4 concurrent inverse-sculpt subagents → merge returned PLAYBOOK traps
between waves (the ratchet) → plateau cross-review → report with
heatmap/slice/comparison renders. Rules: gates are never softened (waivers
are recorded instead), subagents never touch git, framework defects get
fixed in tooling or filed before the next wave.

With this, framework v2 is complete: instruments (surfaceDistance,
voxelDiff), interrogation (probe/slice/trace2code), loop (turn + gates +
state), automation (bootstrap, optimize), knowledge (PLAYBOOK), and
orchestration (skill + agent def). The 21-part re-convergence run is
starting.
