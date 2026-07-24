# 4-Ls — Catalog refresh batch (#929): aggregated feedback from 16 rework agents

**Task:** 14 model-sculpt subagents (plus 2 direct edits) applied the #925 verbs
(scatter/round/smoothWeld/twist/material) to 16 existing catalog entries and
each returned a structured retro. This note aggregates their feedback —
frequency across independent agents is the vote.

## Liked (what the new API got right)
- `deform.md`'s **"round first, label/paint after" rule** was cited by four
  agents as the thing that made their fix a single confident edit instead of
  trial-and-error — explicit trap documentation works.
- `scatter`'s `where(p, n)` predicate handled every real exclusion case
  (cap-only spots, spare-the-pot spines, sloped-foliage-only baubles,
  door/battlement-sparing stonework) with **no manual trig**; sampling the real
  built surface also fixed a latent bug for free (toadstool's hand-computed
  spot ring had buried 9/10 spots inside the cap).
- Multi-angle `--view "az,el;az,el"` tiling + native sharp crops made
  verification cheap; one agent proved a functional fit unchanged with a
  region-scoped symmetric-difference (volume === 0) rather than eyeballing.
- Deterministic seeds + labels surviving `scatter` (label the instance before
  scattering) composed cleanly with the existing paint system.

## Lacked (converging asks — counts are independent agents)
- **`scatter` placement feedback (4 agents).** `count` is a request, not a
  guarantee; the only signal today is counting dots in a PNG. Asks: a
  `placedCount` stat, a dry-run mode returning anchor points, and a documented
  overshoot heuristic. (Already #928 top item — this batch quadruples the vote.)
- **`smoothWeld`/`round` operate on the whole input bbox (2 agents).** Welding
  a thin fin to a large body forces a lattice over everything — one agent
  invented a "local weld" recipe (clip both parts to a tight box around the
  seam, weld, stitch remainders with an overlap shell). Ask: document the
  recipe in deform.md, or better, a `region`/bbox option on the ops.
- **Offset-vs-instance-thickness math (3 agents).** Sizing `scatter`'s
  `offset` against the instance's half-thickness was trial-and-error for
  spots, sprinkles, and stones alike; two first passes fully buried their
  instances. Ask: a worked numeric example in deform.md, or a
  `seat: 'flush'|'proud'|'buried'` convenience.
- **Thin-feature radius limits are sharper than documented (3 agents).**
  round at the doc's suggested radius pilled a 5-unit shell; a 1.2-unit heart
  slab ruled out rounding entirely (CrossSection smoothing won instead);
  fin-fillet radius ceilings floor the achievable lattice resolution.
  deform.md updated this batch with the thin-shell caution; a "radius ≈ 4-6%
  of edge length for a machined look" rule of thumb is still wanted.
- **Surface-exposure stat for labels (1 agent, high value).** Toadstool's
  buried spots had a healthy label triangleCount while being invisible — a
  "fraction of label surface exposed" stat would make that class of bug
  gate-able headlessly.

## Learned (worth folding into docs/practice)
- **`round(mode:'concave')` is the retrofit tool for CSG assemblies** — it
  fills seams/creases while leaving the convex silhouette untouched, and is
  far more robust than `mode:'both'`/`smoothWeld` on shapes with acute swept
  corners (which erode catastrophically at ANY radius). Discovered while the
  rocket-ship agent binary-searched a failure down to a latent
  `extrude(scaleTop=0)` knife-edge fin bug the original model had shipped with.
- Scatter onto the **pre-cut** solid when exclusions exist (watchtower) — no
  anchors on surfaces that later get carved away.
- `api.paint.slab`'s band is one-sided `[offset, offset+thickness]` (doc
  updated this batch), and `circularPattern`'s `radius` shortcut measures from
  the world origin, ignoring a custom `center` (doc updated this batch).
- `round()`'s remesh can *fix* unrelated warnings (a pre-existing sub-0.4mm
  edge vanished) — re-read the whole warnings array after remeshing ops.
- `npm run model:preview -- --json` needs `--silent` or a direct `node`
  invocation (npm's banner breaks JSON parsing; hit by 2 agents — CLAUDE.md
  updated this batch).

## Longed for (new items beyond #928's list)
- `api.placeOnFace(shape, {face})` — "flat 2D relief onto one of a box's six
  faces" placement (companion-cube hand-derived rotation matrices for four
  faces).
- Region-scoped `smoothWeld`/`round` (the local-weld recipe as a first-class
  option).
- Pre-build bbox query on `api.sdf` nodes (cactus agent hand-derived the pot's
  top-z from constructor args to write a `where` predicate).
- A `genus`-change flag in preview output when iterating on one model (the
  fin-weld stitching silently went genus 0→10; watertight and printable, but
  the agent only noticed by manual diffing).
