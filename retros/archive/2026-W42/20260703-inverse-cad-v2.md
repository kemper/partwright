# 4-Ls — inverse-CAD framework v2 + 21-part convergence

**Task:** rebuild the inverse-CAD loop around delta-driven feedback after the
user correctly judged the v1 results "almost all terrible" despite passing
metrics; converge all 21 Dummy 13 parts under calibrated gates. Result:
21/21 all-MUST-green, mean chamfer 0.0083mm (v1's true errors were
1.5–3.3mm), median one authored turn per part.

## Liked

- **Measure-the-instrument-first**: one 5-line self-distance check (mesh vs
  itself) exposed that the v1 metric had a 0.15mm noise floor — the single
  highest-leverage finding of the project. The user's eye had been right
  and the number wrong.
- **The PLAYBOOK ratchet compounded visibly**: thigh 7 turns → shin 1 turn
  → forearm 3 probes + 1 turn. Merging each agent's returned tactics
  before launching the next wave is the mechanism that made 21 parts
  tractable in one session.
- Tool-enforced non-regression (turn.mjs owns the best pointer) caught my
  own two no-op patch bugs instantly via TIE verdicts.

## Lacked

- **A gate-change re-validation pass**: when gates.mjs was fixed mid-run
  (genus convention), an already-"passing" stored best silently became
  stale — I caught it only because the mirror-twin agent flagged it.
  turn.mjs could stamp the gates-code version into best/metrics and warn.
- probe.mjs section has no raw-points JSON output (agents fell back to
  center-rays for cavity r(z) — fine, but undocumented friction).
- bootstrap's signature band merge is too coarse for organic parts (every
  hand agent rebuilt the scaffold with a manual fine-slice loop).

## Learned

- Chamfer/mean metrics are structurally blind to the defects eyes see
  (missing features, wrong shape class); localized signed findings +
  topology + per-part gates are what "visually identical" actually needs.
- LLM agents converge mechanical CAD *fast* when every number comes from a
  measurement tool and structure is the only judgment call — "organic
  parts are hard" was really "the tooling was blind."
- Subagent returns are a knowledge pipeline, not just results: requiring
  "PLAYBOOK candidates" in the return format is what turned 21 independent
  agents into one accumulating system.

## Longed for

- Durable-by-default subagent workspaces: the converged candidates lived
  in gitignored .plans/ on an ephemeral container and had to be rescued by
  an explicit copy-and-commit at the end — a crash before that would have
  lost everything but the chat.
- Rate-limit-resilient background agents (three died mid-part; SendMessage
  resume worked, but only because state files made resumption cheap).
