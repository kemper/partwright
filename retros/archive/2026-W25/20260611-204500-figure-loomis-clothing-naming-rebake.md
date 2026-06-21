---
date: "2026-06-11T20:45:00Z"
task: "feat: head-unit figure proportions + sex selector + coverage clothing + rig aliases (PR #599), and its catalog rebake (PR #600)"
areas: [geometry-api, figure, sdf, docs, verification, catalog, ci]
cost: high
---

## Liked / Worked
- **Research-first framing kept scope honest.** Web-searching the prior art
  (MakeHuman, SMPL, VRM, Daz, HeroForge) up front surfaced the key insight —
  almost all of it targets skinned riggable meshes, not printable solids — so
  the deliverable became "borrow the *data and standards*, not a library." That
  reframing is what made four otherwise-vague asks into concrete, scoped edits.
- **Calibrating the refactor to be a no-op at the default.** Picking head-unit
  ratios so `headsTall:6` neutral is byte-identical to the old fractions-of-H
  meant the whole proportion rework landed with the catalog/tests visually
  unchanged at the default, and an explicit calibration-anchor test pins it.
  Big refactor, tiny blast radius — the safe way to touch a hot, tuned module.
- **Additive coverage over a clean rewrite.** The elegant "garment = body⊕t ∩
  mask" rewrite had real edge cases (bone-perpendicular cuffs, excluding the
  foot) the tuned code already solved. Unioning a body-offset coverage layer
  *under* the existing shaped garment delivered the same guarantee (a body can't
  poke through its own offset) with zero test regressions — the responsible
  version of the idea.
- **model:preview as the proportion oracle.** Rendering chibi(3)/adult(8) and
  male/female in seconds confirmed the headline win before any browser work.

## Lacked
- **`model:preview -p key=val` silently doesn't reach `api.params`.** Two
  renders came back byte-identical (same triCount/bbox) because the param never
  bound — I only caught it by noticing the identical file sizes. Either the flag
  needs a declared paramsSchema to take effect, or it should warn on an unknown
  `-p` key. Cost ~15 min and a fallback to hardcoded variant files.
- **No discoverable map from an example to its catalog bake recipe.** The figure
  catalog entries were never in the batch generators (`generators/*.ts`) and
  `git log -S` found them only in prompt logs — they're baked one-off via
  `scripts/build-catalog-entry.cjs`. Reconstructing the example→out→palette→
  labels mapping took several exploratory greps. A `catalog/bake-manifest.json`
  (or a comment in each example) listing source/palette/gates would make a
  rebake a one-liner instead of an archaeology session.

## Learned
- **Girth scales with the head; length scales with total height.** The figure
  bug was that *all* widths were fractions of H, so only the head responded to
  `headsTall`. The fix is head-units for radii — but NOT for bone lengths
  (head-unit arm length would give chibis gangly arms). That split is the whole
  trick to a coherent stylization dial.
- **`build-catalog-entry.cjs` works headlessly here via `xvfb-run`** (headed
  Chromium for real WebGL) + a backgrounded dev server; `--require-labels` from
  the palette keys is a cheap regression gate. Genus legitimately rises for
  clothed dynamic poses (karate 2→4 from gi + deep stance + bent arm) — manifold
  + componentCount + an eyeballed thumbnail is the real check, not genus alone.

## Longed for
- **`send_later` in web/remote sessions.** The PR-watch playbook explicitly
  wants a ~1h self check-in to catch CI-success / main-moved / merge-conflict
  transitions that webhooks never deliver — but the tool isn't available here,
  so a stacked-PR rebase-after-merge has no automatic trigger. Either expose
  `send_later`, or document a Monitor-based fallback poll for the watch loop.
- **A first-class stacked-PR affordance.** PR #600 (rebake) must merge after
  #599 and needs the new code to bake correctly, so it's based on the figure
  branch and its diff is noisy until #599 lands. A documented convention (base
  against the parent branch? a label?) would beat hand-explaining the stack in
  the PR body each time.
