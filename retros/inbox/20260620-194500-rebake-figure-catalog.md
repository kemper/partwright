# Retro — rebake figure catalog (organic hands + diva sleeves)

**Context:** Follow-up to PR #780. User asked to rebake all catalog figure
thumbnails so the grid reflects the new organic hands + diva long sleeves.
51 figures, full rebuild, uniform 3/4 angle (PR #810).

## Liked
- Opening a catalog entry re-runs `code`, so the engine fix already showed in
  the editor — the rebake was "only" about the static grid thumbnail + stored
  geometryData. Knowing that scoped the work correctly (figures only, 51).
- `build-catalog-entry --palette-from-existing` / `--palette-file` made color
  re-application a one-flag affair once I found the right signal.

## Lacked
- **A `model:preview`-speed path to the COLORED bake.** The whole earlier
  detour ("bake can't run in this container") came from the colored bake
  needing a dev server that nothing told me to start. `model:preview` is
  normal-shaded only, so confirming color/sleeve correctness forced the heavy
  bake. A headless colored render would have closed the loop in seconds.

## Learned
- **"API never appeared" = no dev server on :5173**, not a WebGL/display
  problem. The script is headless; `xvfb` is irrelevant. Cost me an hour and a
  wrong "container can't bake" conclusion in the prior turn. Fixed the
  misleading CLAUDE.md note in this PR (#727/#728).
- **Stored `colorRegions` carry `kind:null`, not `kind:'byLabel'`.** Detecting
  "does this figure have a palette" off colorRegions baked 46 figures GRAY.
  The reliable signal is palette-FILE existence. Caught after 2 entries by
  actually *looking* at the first colored output — the manual-verification
  habit paid off.

## Longed for
- A batch rebake target (`npm run catalog:rebake -- --figures`) that starts the
  dev server, loops the figures with per-entry palette detection, and verifies
  a montage — so this is one command next time instead of a bespoke driver.
- A CI freshness check (#732) that flags when a figure source drifts from its
  bake, so "the thumbnails are stale" surfaces automatically instead of via a
  user screenshot.
