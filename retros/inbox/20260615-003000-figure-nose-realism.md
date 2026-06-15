# Retro — figure nose realism (presets + carved nostrils + sculpted form)

**Task:** significantly upgrade the figure-API nose — carved nostrils, nose-type presets, more defined/projecting form. PR #673. Spanned several rounds with user-in-the-loop on the look.

## Liked
- The "measure when smoothUnion is involved" rule in CLAUDE.md paid off directly: the first nostril attempt carved a *buried bubble* (the flared alae bulge the underside ~1.65·tipR below the analytic tip), and a 30-line `vite-node` SDF probe walking `evaluate` down each nostril column found it in one pass instead of guessing camera angles. Then I baked that measurement *into the builder* (`surfaceDrop` samples the pre-carve surface so the cavity always straddles it) — robust across every preset/flare/width.
- `model:preview` DOES resolve `api.paint.label`, so fully-colored busts (skin/eyes/iris/lids/hair/lips) render headlessly with no xvfb bake. That made the "show me real faces" loop fast.

## Lacked
- I burned ~4 turns early fighting camera azimuth/elevation to *see* the nostrils (kept cropping the mouth/chin instead of the nose). The SDF probe was the thing that actually unblocked me — I should reach for a numeric probe *first* when "is this feature even there" is the question, before iterating on render angles.
- No quick "is the carve creating an internal void / does it stay manifold" headless check besides eyeballing `componentCount`. The 3D grid-scan I wrote for the unit test is reusable for exactly this — worth promoting to a helper.

## Learned
- **Aesthetic work needs the user's eye in a real context, early.** I shipped a v1 the user called "bland," then learned the actual bar was "show it in a fully-featured face, not isolated." The CLAUDE.md rule (prototype 2–3, render ≥4 angles in colour, let the user pick) is right — but the *context* (full bust vs bare nose) matters as much as the count. Lead with the richest realistic preview.
- Hardcoded sample-point geometry tests are brittle: projecting the tip forward broke a fixed-point nostril-carve assertion. A grid/column *scan* asserting "the carve removed material somewhere in this region" survives tuning.
- Carved-smile mouths alias into speckle on long/narrow faces at figure scale (separate from the nose) — a recurring sub-cell-feature trap; main is actively reworking mouths (`expression`/`lipShape`), so it's on the radar.

## Longed for
- A headless **"figure smoke" check** (same ask as prior retros): manifold + `voxelPieceCount`/component sanity + paint-label→triangle-count + genus, in one call. Several whole classes of figure bug (buried-bubble voids, 0-triangle paint labels, carve genus spikes) are only caught by ad-hoc probes or the slow bake today.
- `model:preview --view` presets that target *face features* (e.g. `--view nose-underside`, `--view face-3q`) so I'm not re-deriving az/el every time I want to inspect the same anatomical spot.
