---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - scripts/cli/judge.mjs
  - scripts/eval-models.mjs
  - evals/README.md
  - evals/cases/glasses/model.js
  - evals/cases/makeup/model.js
  - evals/cases/hat/case.json
---

## Human

Use the merged `eval:models` vision-judged loop for the accessory work; an agent
fetched reference images for all 7. (When the in-container Claude judge produced
nonsense scores, decided: fix the harness now.)

## Assistant

The Claude judge couldn't actually judge fine accessories — three failures, all
in the harness, not the models:

1. **The judge couldn't read its own image.** It attaches the contact sheet via an
   `@<path>` mention assuming "no Read permission needed," but in this container
   that prompts for Read permission, so the judge returned a "please grant
   permission" string (→ "did not return JSON") on 3/6 cases and hallucinated a
   "blank model" critique on the others. `--dangerously-skip-permissions` is
   REFUSED under root, so the fix is `--allowedTools "Read"` on the `claude -p`
   call (scoped, from a tmp cwd — nothing in the repo is writable). Verified the
   judge then actually describes the image.
2. **The accessory was invisible even when read.** The contact sheet downscaled
   the candidate to one TILE width (~192 px/tile at TILE 384), so a head was ~40 px
   and glasses/makeup vanished before the judge saw them. Raised `TILE` 384→640 and
   rewrote `contactSheet` to scale both panels to a common 1024 px height (not
   squish to one tile), keeping the sheet's long side near the vision API's ~1568 px
   downsample ceiling.
3. **Framing: a face accessory on a full bust is still tiny.** The renderer fits
   the whole model bbox to the tile, so on a head+torso+arms bust the head (where
   glasses/makeup live) is a small fraction. Fix is per-CASE: the glasses and
   makeup eval `model.js` now build **head + neck only** so the face fills the
   frame. (The full-figure showcases stay in `.plans/accessories/`.) Documented
   this "frame the case to its subject" rule in `evals/README.md`.

Result: glasses went 4/100 (judge saw "blank face") → 42/100 with accurate,
grounded per-item critique (sees the rims + bridge; correctly flags flush lenses
in the 3/4 view, thin rims, hard-to-see temple from that angle). The absolute
number is capped by the real reference being a B&W vintage portrait in a hat — so
the VALUE is the per-item checklist + regression baseline, not the scalar. Also
fixed the hat case gate (its model doesn't label skin/hair → require only `hat`).
Filed #831 for the related `partwright fetch` no-User-Agent → Wikimedia 429 bug.
