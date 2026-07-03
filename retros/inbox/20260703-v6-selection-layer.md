# 4-Ls — v6 selection layer (PR #870, owner-driven ideation → same-day ship)

**Liked**
- The owner's non-expert framing ("let the AI lasso a region, label it,
  paint only inside") mapped exactly onto the right architecture — the
  design conversation produced a better abstraction (selection = uncolored
  region) than another round of per-tool bleed patches would have. Naming
  the missing noun beat fixing five symptoms.
- The validation agent hit both owner-specified detail targets (radial
  wedge shoulders, concentric pupil rings) on the round the primitive
  shipped, with zero unpainted islands — the tightest ideate→build→
  validate loop of the whole PR.

**Lacked**
- No cross-cutting statement of the re-tessellation contract. Each tool
  documents its own smoothing, but "smooth paints renumber triangles
  EVERYWHERE, invalidating every captured id" lived nowhere — the v6
  agent burned ~3 iterations rediscovering it. Ordering rule now in
  colors.md, but an API-level guard (version-stamp triangle-id captures,
  reject stale ones) would make the mistake impossible instead of
  documented.
- Return-shape consistency: three rounds of agents have now each spent a
  cycle on renderView returning a string where siblings return objects,
  and nested vs flat result fields. A one-shape-per-verb convention sweep
  is overdue.

**Learned**
- A fixed-size scan window in a meta-test (apiParity's 400 KB cap) is a
  time bomb that defuses itself into false confidence — it failed exactly
  the way its own comment said the previous 80 KB cap failed. Scan to the
  end; never window a completeness check.
- "Selection = region without color" meant ~90% machinery reuse; the
  whole layer (store, algebra, scoping on 8 tools, partition kernel,
  schemas, docs, tests) landed in one session because the abstraction
  aligned with existing structure instead of fighting it.

**Longed for**
- Analytic cell-boundary subdivision for paintPartition (wedge edges
  stair-step on coarse spheres; thin rings need widening) — tracked #881.
- Triangle-id capture stamping (see Lacked) — the structural fix for the
  ordering trap.
- The scoped-paintInBox coverage-gap repro from the v6 agent (two boxes
  in one shared selection → holes) needs investigation — tracked #881.
