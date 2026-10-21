# 4-Ls — inverse-CAD armor phase (genericity proof + smooth hands)

**Task:** extract 16 unseen armor parts from a user 3MF, converge them with
the existing framework, and productionize levelSet smoothing for the hands.
Result: 37/37 total corpus converged; armor mean chamfer 0.0036mm with
three bit-exact parts, median ONE authored turn per part.

## Liked

- **The ratchet compounding across a new geometry class**: the armor recipe
  matured over the first three parts and then went 13-for-13 with agents
  reporting "textbook confirmation, no new tactics needed."
- The gates catching a real defect in the framework's own new tool (naive
  SDF blending fabricates genus) — the topology MUST gate did exactly the
  job scalar metrics can't.
- Safety-best banking (stock levelSet turn first, refine after) removed all
  drama from the harder parts.

## Lacked

- **Orchestration bookkeeping**: armor_shoulder was silently never assigned
  an agent (a bootstrap-converged sibling made the launch count look
  complete) — caught only by the final sweep table. A driver script
  (status.mjs from the original design, never built) would have shown the
  hole immediately.
- The stop-hook fired ~20 times during long agent waits with nothing to
  reconcile; a "background agents in flight" suppression would help.

## Learned

- Facet-census plane-count is a near-perfect router (collapse = CAD-exact
  decode possible; ~tris/2 = curved, go levelSet), and low-poly CAD exports
  can be reconstructed BIT-EXACT by reading plane equations off the mesh.
- 3MF is trivially extractable (ZIP + XML + Slic3r config names) — corpus
  intake from user uploads is a solved problem now.
- Very long-running subagents (the 6-hand agent: ~190 tool calls) work
  fine; on-disk state files made liveness checkable without touching their
  transcripts.

## Longed for

- A convergence driver (status table + auto-refill + completion detection)
  instead of manual pool management across ~20 agent launches — the
  orchestration was the only part of this phase that didn't scale itself.
