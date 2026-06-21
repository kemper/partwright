# Retro — figure accessory / attachment system

Built the attachment layer (frames + verbs), 7 accessories, an eval corpus, 3
catalog showcase figures, then a big review-fix pass.

## Liked
- **Fixing at the API level prevented whole classes.** The grip palm-side, hat
  height, and band conformance were one-line/one-helper fixes in `sdfFigure.ts`
  that corrected every figure at once — far better than per-figure tweaks.
- **One conformance primitive unified three bugs.** A `marchToSurface` ray-march
  (clothed body → flush placement) fixed the floating belt, the dress-embedding
  necklace, AND the buried strap. Conform to the real surface, not an analytic
  ellipse.
- The merged smooth/AA rasterizer + the eval loop made review fast.

## Lacked
- **No automated check that held props seat on the PALM.** The back-of-hand bug
  shipped and was caught by the user. Added a unit test after the fact — should
  have existed when the grip frame was introduced.
- A paint-free, conformal makeup pattern wasn't documented; the first attempt
  used coordinate mesh-paint boxes (rectangular, rig-dependent, ugly).

## Learned
- **`taper` is anchored at z=0** (`s = 1 + rate*z`): a CENTERED box flares at the
  base. Base-anchor it (translate base to z=0) before tapering. And taper scales
  BOTH cross-axes — to taper width only (a flat blade) intersect a constant-thin
  slab with a width-tapering wedge whose other axis is huge.
- **Grip `palmNormal` must match the hand builder** (`placedHand`: canonical palm
  +Y → `cross(foreDir, hinge)`); the opposite sign puts props on the knuckles.
- **Seat hats on the head, not the hair top** — hair volume floats them high.
- **Makeup, paint-free:** reuse the `lips`/`lids` labels and add a conformal
  proud patch (`skin.round(proud)` ∩ a region cylinder) for blush — label-coloured,
  rig-independent, printable.

## Longed for
- **Per-axis `taper`** (width-only) — would have made the blade trivial.
- A first-class **conformal surface-marking / `api.paint.sphere`** for makeup &
  decals (the `skin.round ∩ cylinder` trick should be a helper).
- **Eval focus-zoom for full-figure parts** — the judge under-scored the sword/
  belt/armor because they're tiny in frame, so it caught NONE of these defects;
  high-res `model:preview` by eye did. Tracked on #828.
