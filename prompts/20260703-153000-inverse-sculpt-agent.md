---
session: "inverse-cad"
timestamp: "2026-07-03T15:30:00Z"
model: claude-fable-5
sequence: 12
---

## Human

(continuation — v2 framework build)

## Assistant

## Key decisions

**`.claude/agents/inverse-sculpt.md`** — the per-part convergence subagent
the orchestration layer spawns (one per part, ~4 concurrent). Contract:
read PLAYBOOK first, respect strategiesTried, one hypothesis per turn via
turn.mjs, measure via probe.mjs, optimizer for numbers, ≤15 turns, plateau
protocol, text-only return including PLAYBOOK trap candidates so the
orchestrator can ratchet the field manual between waves. Explicitly barred
from git, from other parts' directories, and from patching the tooling
(broken tools get reported, not worked around).
