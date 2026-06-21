---
date: 2026-06-15
branch: claude/adoring-lamport-gmg9mn
files_changed:
  - examples/figure_*.js (20 new full-body figure sources)
  - public/catalog/palettes/*.json (20 new palettes)
  - public/catalog/*.partwright.json (20 new baked entries)
  - public/catalog/manifest.json
---

## Human

After merging a wave of figure-API features (appropriate body sizing, nipples,
belly buttons, eyelids, gaze direction, ears, hair improvements, feet/toes, …),
add ~20 new catalog entries that lean on ALL of those features together so the
quality of the recent work can be observed as a whole. Use ~10 Opus subagents.
Requirements: full-body creations only (no busts), a decent variety of body
positions (to exercise the body mechanics), and concepts different from what the
catalog already has. Open a PR so the entries can be reviewed on the PR preview.

## Assistant

Approach: treat this as a fan-out of 20 independent `api.sdf.figure` models, each
chosen to (a) be a distinct body mechanic and (b) collectively cover every new
feature axis. Designed the roster up front so coverage was deliberate rather than
incidental — every nose type, every eyelid preset, gaze directions, all hair
styles/textures, the full body-axis range (baby 3.6-heads → elderly, slim →
stocky, plus muscle/weight/bust/sex/headsTall), nipples + navel on the bare-chest
figures, feet + toes vs footwear, and held/standing props (axe, bow, barbell,
ball, staff, cloche, surfboard) — and all 20 distinct from the existing catalog.

Pipeline decisions worth recording:

- **Verified the full bake pipeline before fanning out.** Confirmed headless
  `model:preview`, the `xvfb`-driven colored bake, and a clean thumbnail all work
  in this container first, so the 10 authoring subagents weren't committed to a
  broken path. Subagents (Opus 4.8) authored source + palette and verified
  geometry only; the orchestrator owned every git/bake step (single-writer).

- **The colored bake — not `model:preview` — is the real correctness oracle.**
  `model:preview` (Node SSR) does NOT validate paint-label resolution and can
  diverge from the browser on `componentCount`. The first bake gated 8/20 on
  `--require-labels` and surfaced two browser-only failures `model:preview` hid:
  a figure that smooth-unioned a prop over the fully-labelled body (a trailing
  `smoothUnion` wipes ALL paint labels — "smooth blends can't carry labels"), and
  marginal welds that fused in SSR but split into 5 components in the browser
  (driven partly by `coils` hair relief aliasing into islands at a coarse
  `edgeLength`). Fixes were re-delegated to bake-verifying subagents.

- **Buried features ≠ aliased features.** Several eye-paint failures were the
  eyeballs being swallowed by prominent cheekbones, or a pupil tucked behind an
  upper lid under a full `gaze:'up'` — fixed by exposing the eyeball / using a
  modest gaze pitch, not by meshing finer. An over-fine `eyeEdgeLength` recipe
  actively backfired (exploded one model to 465k tris / genus 680 without fixing
  the buried pupil). The eye/teeth fixes that DID need finer meshing land heavy
  (~300–405k tris, above the ~200k advisory budget) — accepted for a quality
  showcase, flagged as a follow-up to trim.

All 20 entries bake to a single watertight component (`componentCount: 1`,
`isManifold: true`) with every palette label resolving.
