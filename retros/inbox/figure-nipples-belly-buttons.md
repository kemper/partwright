# Retro — figure nipple/navel torso relief (PR #667)

## Liked
- `model:preview` + native `sharp` crops made the aesthetic verification tight:
  render front at 1600px, crop the torso, judge "relief vs stuck-on ball" in one
  Read. The colored catalog bake (build-catalog-entry) was the right final check
  since model:preview shades by normal and hides paint.
- The rig already had the right shape: `rig.face` anchors were a clean precedent
  to mirror for `rig.torso`, so the API design wrote itself.

## Lacked
- The catalog has TWO sources of truth (examples/*.js source + baked
  public/catalog/*.partwright.json), and the manifest references only the baked
  json. Editing the .js does nothing visible until a re-bake — easy to forget.
  bake-manifest.json maps id->source but there's no one-shot "re-bake every
  entry whose source changed" command; I baked each entry by hand.

## Learned
- The torso ellipsoids stay AXIS-ALIGNED under a spine lean (only their centres
  are spine-transformed), so "front = -Y" holds for surface projection even when
  posed. That single fact made the nipple/navel placement a simple closed-form
  projection instead of a frame transform.
- model:preview's `--view az,el` azimuth convention is NOT the same as the named
  `--views front` — `--view 0,5` gave a side profile. Use named views for a
  reliable front.
- Custom-muscle figures (strongman's puffed pecs) sit FORWARD of the base chest,
  so the base-chest nipple anchors get buried — a builder that adds chest mass
  must place its own nipples. Documented this caveat in figure.md.

## Longed for
- A `npm run catalog:rebake -- <id...>` (or `--changed`) that reads
  bake-manifest.json (source + gates + palette) and re-bakes the named entries,
  so a source edit doesn't require remembering the full build-catalog-entry
  invocation per entry. The palette/gates are already declared; only the
  --palette-file path and require-labels had to be retyped each time.
