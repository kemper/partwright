---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-19T02:15:00Z"
tools: [Read, Write, Edit, Bash, Grep]
---

## Human

Add one new seeded part detector, `random-walker`, to the part-detection
registry (tracking issue #1025). It competes with `crease-watershed`: same
named seeds, but boundaries come from a diffusion (Lai et al. 2008), which
should give smoother boundaries where grooves are faint or broken and a soft
probability field usable as a smooth paint-clip field. Add unit tests and a
bench row, tune the default beta on `segment:bench`, and compare against the
crease watershed on a real figurine scan.

## Assistant

## Key decisions

**Graph and weights.** Triangles are nodes, shared edges are edges. Weight
`exp(-beta * d / mean(d))` with `d = eta * (1 - cos dihedral)`; eta is 1 on
concave folds and `convexFactor` on convex ones. Normalising by the mean makes
beta scale- and model-independent. Weights are floored at 1e-6 so a very sharp
groove weakens coupling without disconnecting the system.

**Solver.** Jacobi-preconditioned CG over only the free (non-seed, reachable)
triangles, in a fixed-width table numbered in BFS order, with an unrolled
3-neighbour matvec (about 2x faster than the generic CSR loop). Seed
contributions fold into the diagonal and the right-hand side. The reachable
set and the warm start both come from one hybrid crease-watershed growth, so
triangles in seedless pieces are removed from the system (it stays
non-singular) and a truncated solve is still a sensible labelling.

**Things tried and dropped, measured on a 460k-triangle scan.** A narrow band
around the watershed boundaries (fast, but the sleeve leak is a ~100-ring
error so it cannot be repaired), a coarse aggregation solve as the initial
guess (blurred start, boundaries left the grooves: groove fidelity 0.49 vs
0.89), a Galerkin coarse-grid correction of the watershed start (no measurable
gain), and a 4-label interleaved block solve (slower in JS). Convergence is
iteration-bound, so the cap is the time knob: the leak fix needs roughly 180+
iterations, hence default 300 plus a 'Fast solve' preset at 80.

**Tiny parts survive clean-up.** Island absorption weights seed triangles at
Infinity, so a deliberately tiny part (an eye) whose area is under
`minIslandPct` is never swallowed by its neighbour.

**Clip field.** Vertex costs use `1 - p` with p averaged over the vertex's
incident assigned triangles, candidates restricted to labels that occur on
those triangles, so the field stays consistent with the triangle boundary.
