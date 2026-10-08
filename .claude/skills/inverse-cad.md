---
name: inverse-cad
description: >-
  Drive the headless inverse-CAD pipeline: recreate a target STL (single- or
  multi-part) as parametric manifold-js code until calibrated visual-identity
  gates pass. Orchestrates splitStl → per-part init/bootstrap → waves of
  inverse-sculpt subagents → status/report. Use when the user hands you an
  STL to reverse-engineer, or to resume a partially-converged run.
---

# Inverse-CAD orchestration

You are the driver; per-part convergence belongs to `inverse-sculpt`
subagents. All tooling lives in `scripts/inverse-cad/` (see its README and
PLAYBOOK.md). Run state lives in a gitignored project dir, one subdir per
part, each with `state.json` as the resume file.

## Procedure

1. **Setup (deterministic).** Multi-part STL → `splitStl.mjs` first. Then per
   part:
   ```bash
   node scripts/inverse-cad/turn.mjs init <projDir>/<part> <part.stl>
   node scripts/inverse-cad/bootstrap.mjs <part.stl> --out <projDir>/<part>/bootstrap.js
   node scripts/inverse-cad/turn.mjs <projDir>/<part> <projDir>/<part>/bootstrap.js --note "deterministic bootstrap"
   ```
2. **Triage.** Read each part's `state.json`: parts already `phase: done`
   skip to the report. Sort the rest by score descending (worst first).
3. **Waves.** Spawn one `inverse-sculpt` subagent per unconverged part,
   ~4 concurrent (engine/CPU contention — same reason Playwright pins
   workers:1). Each gets: the part dir path, the instruction to read
   PLAYBOOK.md first, and its budget (≤15 turns).
4. **Between waves (the ratchet).** Merge returned PLAYBOOK trap/tactic
   candidates into `scripts/inverse-cad/PLAYBOOK.md` §7/§5 BEFORE the next
   wave. Respawn fresh subagents for unconverged parts (fresh context +
   state file beats a stale session). Per-part budget: 4 sessions, then
   plateau handling.
5. **Plateau handling.** A part returning `plateau` twice gets one
   cross-review: a different agent reads only `best/metrics.json`,
   `compare.png` + `notes.md` and answers "what shape CLASS is wrong?".
   Third plateau → escalate to the user with the comparison images and a
   specific question, or record an accepted waiver in notes.md.
6. **Report.** For the final state: per-part gate table (from each
   `best/metrics.json`), before/after comparison renders
   (`heatmap.mjs`, `sliceOverlay.mjs`, `eval.mjs` comparison PNGs), and the
   sweep summary. Deliver images to the user via SendUserFile.

## Rules

- Never run two git-mutating steps concurrently with subagents; subagents
  never touch git at all.
- The gates (`gates.mjs`) are the acceptance predicate — do not soften
  thresholds to make a part pass; record a waiver instead.
- Every framework defect a subagent reports gets fixed in the tooling (by
  you, not them) or filed as an issue before the next wave.
- Convergence data (`state.json` history) is evidence for the final report —
  don't delete part dirs after success.
