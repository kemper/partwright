# Sculpt

Build (or refine) a model that looks like a target — a photo, a described
subject, a catalog toy, a mechanical part — by delegating to the `model-sculpt`
subagent, and surface the result **without paying image-token cost on the main
thread**. This is the standard entry point for photo→figurine and "make a model
that looks like X" work, across all three headless engines.

## Why this is a skill (not done inline)

The expensive part is the render→look→adjust loop: every preview PNG you'd Read
to judge a pass stays in the main context and is re-billed on every later turn.
This skill keeps that loop inside the subagent's *disposable* context and only
ever brings back text + file paths.

> **The cost invariant — do not break it:** never `Read` the preview PNG in the
> main thread. The subagent already judged it; you ship it **unread** via
> `SendUserFile`. Reading it here defeats the entire reason the subagent exists.

## Steps

1. **Resolve the engine.** Headless options:
   - `voxel` — photos→figurine, pixel-art, blocky toys (palette-constrained).
   - `manifold-js` — smooth / organic solids, fast booleans.
   - `scad` — parametric mechanical parts (gears, threads, brackets; BOSL2).

   If the request names one, use it. Otherwise infer and state your choice (a
   photo → `voxel`; "smooth/organic" → `manifold-js`; "gear/thread/bracket" →
   `scad`). **`replicad`/BREP is NOT headless** — if asked for it, say so and
   verify in the browser instead; don't route it to `model-sculpt`.
2. **Gather the brief.** The target description, and for `voxel` the color
   palette (hex list). For a refinement pass, the prior model file to start from
   and the specific changes wanted. Ask only if genuinely missing — don't
   interrogate.
3. **Pick output paths** under `.plans/` (e.g. `.plans/<slug>.js` +
   `.plans/<slug>.png`; `.scad` for the scad engine).
4. **Launch the subagent** with the Agent tool, `subagent_type: model-sculpt`,
   passing: the engine, the target, palette/constraints, the output paths, the
   gates, and explicitly "return text only — do not paste or send images."
5. **Relay + surface.** When it returns: relay its `LIKENESS` + `TRADE-OFFS` and
   the `STATS` line to the user, and `SendUserFile` the `PREVIEW` path **without
   Reading it**.
6. **Offer a refinement pass.** Ask whether they want tweaks; if so, re-launch
   `model-sculpt` with the prior file as `START FROM` plus the requested changes.

## Notes

- `model-sculpt` runs on Sonnet, so the cheap-to-judge geometry loop doesn't burn
  Opus tokens.
- A freshly-added skill or agent isn't selectable until the next session (the
  registry loads at session start). To exercise one in the session that created
  it, run its instructions through `general-purpose`.
- See `docs/agent-tooling.md` for the full `model-sculpt` rationale and the
  per-engine headless support matrix.
