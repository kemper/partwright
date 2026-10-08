---
date: 2026-06-17
task: fix the expectant_mother catalog figure (PR #708)
---

## Liked
- `model:preview` + the colored `build-catalog-entry.cjs` bake (with
  `THUMB_AZIMUTH/ELEVATION`) made diagnosis empirical: probing the rig
  landmarks (`__figureTestables__.buildRig`) gave exact Z/Y of the bump, hips,
  top hem and skirt waist, which pinned down *why* it looked wrong instead of
  guessing.
- Cropping the colored bake at high res with `sharp.extract` caught a color
  bleed patch (skin label on the dress hip) that was invisible at thumbnail
  size — the "inspect at high resolution" rule paid off.

## Lacked
- A re-bake of the figure catalog after an engine fix does NOT re-tune per-entry
  hand-built geometry. This figure's belly was a manual ellipsoid added once and
  never revisited; the #701–#707 engine fixes sailed past it. There's no signal
  that flags "this catalog entry looks bad" — only a human reviewing thumbnails.
- `F.clothing.top` shells the **rig torso**, not any custom welded bump, so a
  standard top can't drape over a pregnancy bump. Not documented where you'd
  look; learned by reading `buildTop`.

## Learned
- Over-correcting is its own defect: my first fix lowered the bump so far it sat
  below the hip joint and read as a "cone from the crotch." Always check a
  custom feature against the body landmarks it must respect (here: keep the
  bump bottom above the hip joint).
- For a figure, "appropriate" is mostly about **coverage + where the swell
  sits**, not just bump shape. The bare-midriff + low-skirt combo left the whole
  abdomen bare — that, not the bump alone, made it read as near-nude.

## Longed for
- The CLAUDE.md "prototype 2–3 options and let the user pick BEFORE wiring it in"
  rule for subjective work — I shipped one interpretation twice before the user
  steered me. For a figure's *clothing/silhouette*, a quick colored A/B montage
  up front would have converged faster.
- A catalog-thumbnail contact-sheet command (montage every figure's hero bake)
  so a human/agent can spot the bad ones at a glance instead of opening each.
