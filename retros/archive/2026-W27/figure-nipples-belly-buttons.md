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

---

## Round 2 (areola colour + bust, after user feedback)

### Liked
- `api.paint.label('skin', hex)` in a model snippet IS resolved + shown by
  `model:preview` (it shades by normal otherwise). So colour decisions —
  areola-darker-than-skin, palette choices — can be verified headlessly without
  the full xvfb catalog bake. Big speedup for any colour-sensitive figure work.
- Prototype-then-AskUserQuestion was the right call for the aesthetic asks: built
  throwaway areola + bust-sweep montages, got 4 crisp decisions, then wired once.
  Far cheaper than implementing one interpretation and iterating.

### Learned
- The eyes' "iris-disc trick" (coin clipped from a sphere a hair larger than the
  surface) is the reusable primitive for ANY flush, paintable, curvature-following
  decal on a figure — areola here, could be tattoos/emblems next. Worth promoting
  to a shared `F.decal`/helper if a third use appears.
- Paint labels MUST be top-level hard-unions, never inside `F.weld` — a smooth
  weld flattens the label to 0 paintable triangles. The areola had to move out of
  `F.torso` into its own `F.nipples` part for exactly this reason (same lesson the
  eyes already encode). A torso *option* that needs its own colour is a smell.

### Longed for
- A `model:preview --palette <file>` flag that applies a label→colour palette to
  an SDF-`.label()` figure for a coloured headless render, so you don't have to
  hand-write `api.paint.label(...)` lines in a scratch snippet to preview catalog
  colours. (Today colour preview needs either scratch api.paint calls or the slow
  xvfb bake.)
