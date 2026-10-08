# Retro — conforming front/back-panel garments (apron pass-through)

**Task:** chef apron passed through the body; fix this model + the whole class.

## Liked
- `model:preview`'s 0-triangle-label warning caught the apron burying under the
  jacket *before* I shipped it — the headless paint-QC gate paid off immediately.
- The existing "clothing = body region inflated + trimmed" rule in buildTop/buildPants
  gave a ready-made, proven pattern to generalize; the fix was "apply the same rule
  to a front slab," not invent physics.

## Lacked
- No `F.clothing.panel`/apron existed, so every apron/bib/tabard/cape was hand-rolled
  as a flat box at a guessed Y — the exact pass-through trap, repeated per model.
- Catalog entries bake a mesh+thumbnail, so a code-only fix leaves a stale preview;
  re-baking needs the xvfb pipeline. A "catalog entry whose code changed" lint/CI
  flag would catch code/mesh drift automatically (deferred to #753).

## Learned
- A conforming garment must sit **proud** of the under-garments or it buries and paints
  nothing — derive thickness from the layers beneath, don't pick an absolute offset.
- The single-Y flat panel is geometrically incapable of following a curved torso; the
  regression test that encodes this is "covers the body front at *two* heights."

## Longed for
- A capability/registry link so a new hand-rolled garment in model code could be nudged
  toward the helper — the parity gap (UI/example reaches for a primitive the helper layer
  already solves) is invisible to static lint.
