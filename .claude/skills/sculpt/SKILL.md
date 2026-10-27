---
name: sculpt
description: "Build or refine a model that should look like a target (photo, described subject, catalog toy, mechanical part) by delegating the render-look-adjust loop to the model-sculpt subagent, keeping preview images out of the main context. Use for photo-to-figurine and 'make a model that looks like X' work."
---

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
   interrogate. With reference **photos**, also collect each photo's path and
   the CLI camera that matches it (`front.png@0,0`, `back.png@180,0`, or
   `@front` / `@back`) plus the `--match-*` flags it needs (`--match-pixel-aspect`
   for stretched video frames, `--match-exclude base`, a `--match-mask` for a
   busy backdrop).
3. **Pick output paths** under `.plans/` (e.g. `.plans/<slug>.js` +
   `.plans/<slug>.png`; `.scad` for the scad engine), plus
   `.plans/<slug>.checklist.md` for the feature checklist.
4. **Feature checklist up front.** Before any modelling, the reference is
   reduced ONCE to a short checklist of 5–10 defining, checkable features —
   proportions ("head ≈ 45% of height"), silhouette masses ("spiky hair flares
   past the ears"), placement ("ball held at the right hip"), colours. If the
   main thread hasn't looked at the photo, let `model-sculpt` write it on its
   first pass (it saves it to the checklist path and returns it). Every later
   pass, and every critic call, is scored against this list — it is what stops
   a sculpt from drifting toward "looks fine" while a defining feature is
   missing.
5. **Launch the subagent** with the Agent tool, `subagent_type: model-sculpt`,
   passing: the engine, the target, palette/constraints, the output paths, the
   references + cameras + match flags, the checklist path, the gates, and
   explicitly "return text only — do not paste or send images."
6. **Checkpoint critic.** `model-sculpt` stops on a **plateau** of the numeric
   score (or after a batch of ~5 passes) and returns. That is a checkpoint:
   launch `subagent_type: model-critic` (read-only) with the model file, the
   references + cameras, and the checklist. It renders at the matching angles
   and returns a ranked top-3 fix list. Relaunch `model-sculpt` with `START
   FROM` = the current file and those three fixes. Call the critic **only at
   checkpoints** — never every pass; it spends image tokens, and the
   text-only `--match-photo` score covers routine passes. Stop when the critic
   reports only polish items, or the score and checklist stop improving across
   two checkpoints.
7. **Relay + surface.** When done: relay `LIKENESS` + `TRADE-OFFS`, the `STATS`
   and `SCORE` lines to the user, and `SendUserFile` the `PREVIEW` path
   **without Reading it**.
8. **Offer a refinement pass.** Ask whether they want tweaks; if so, re-launch
   `model-sculpt` with the prior file as `START FROM` plus the requested changes.

## Notes

- **Why numbers + checklist + checkpoints:** a fixed pass count either stops
  early or burns passes on noise, and an agent judging its own renders drifts.
  The text-only photo-match score (`model:preview --match-photo`, mean
  silhouette IoU over every reference view) decides keep/revert per pass for
  free; the checklist keeps defining features from being traded away for IoU;
  the critic is a fresh pair of eyes at the moments numbers stop helping.

- `model-sculpt` runs on Sonnet, so the cheap-to-judge geometry loop doesn't burn
  Opus tokens.
- A freshly-added skill or agent isn't selectable until the next session (the
  registry loads at session start). To exercise one in the session that created
  it, run its instructions through `general-purpose`.
- See `docs/agent-tooling.md` for the full `model-sculpt` rationale and the
  per-engine headless support matrix.
