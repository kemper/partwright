# Retro — figure bust/nipple placement raise + catalog re-bake (PR #709)

## Liked
- `model:preview` (shaded) + a single colored `build-catalog-entry` bake was enough to
  *prove* the bug (skin breast below the gown) and the fix before touching CI. The
  bare-figure preview isolated the breast cleanly from clothing.
- `catalog-regen.cjs` build mode re-baked all 20 entries from each entry's own stored
  `code` + `colorRegions` — a generator script reading the JSONs made it a one-shot.

## Lacked
- The per-entry hero CAMERA isn't persisted in `.partwright.json` (only the rendered
  PNG), so re-baking relies on knowing the convention (30°/45° iso). Had to reverse it
  by eyeballing existing thumbnails. A stored `view`/camera field per version would make
  re-bakes reproducible instead of guessed.
- `paintByLabel` rejects hex and wants `[r,g,b]` 0..1 — but `build-catalog-entry
  --palette-file` wants hex. Two color formats across two bake paths cost a round-trip.

## Learned
- The nipple/mound line was anchored to the chest ellipsoid's `chestSemiZ`, which is
  **capped large** by the shoulder cap — so a "small fraction below centre" silently
  became a big drop on tall/stocky rigs. Anchoring landmarks to a *capped/derived*
  dimension is a latent scale bug; head-units off a stable joint (shoulder) is robust.
- Raising the nipple interacted with `buildNipples`: on muscled BARE chests the pec
  bulges forward of the chest ellipsoid the areola anchor rides, so the flush disc got
  swallowed (`areola → 0 triangles`). The catalog re-bake — not the unit tests — caught
  it. Browser bake is the real integration test for figure label-resolution.

## Longed for
- A `componentCount`/label-resolution **gate in the headless preview** for figures
  (e.g. `--require-labels areola,iris`) so the areola-burial would surface at
  `model:preview` time instead of only in the browser re-bake.
- A pinned "as-of" date for `catalog.test.ts`'s rolling-year window. A wall-clock-relative
  assertion turns into a time-bomb that reds every PR's `build-unit` the day a model
  crosses 1yr old (hit here as #712 — unrelated to the change but blocking).
