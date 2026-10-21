# Retro — figure armpit / shoulder weld fix

## Liked
- The `weld(rig, parts, {k})` override let me test the whole hypothesis (is the
  web caused by the weld radius?) on a scratch copy of the swimmer **before
  touching source** — `sed` the example, `model:preview`, look. Confirmed the
  root cause in one cheap render instead of editing the engine and guessing.
- `model:preview` across poses (swimmer/bodybuilder/ballerina/dunk) made the
  "does this regress arms-up or muscled figures?" check fast and visual.

## Lacked
- `model:preview` cleans up the prior stamped PNG for the *same model file* on
  each run, so rendering "after" silently deleted my "before" render twice while
  I was building a comparison. Had to learn to write before/after to fixed
  `--png /tmp/...` paths (which dodge the cleanup). A short note in the
  `model:preview` docs ("stamps are per-model and old ones are pruned — use
  `--png` to a fixed path to keep an A/B pair") would save the rediscovery.

## Learned
- The figure rig has no trapezius for muscle:0 figures — the neck plugs straight
  into the chest and the deltoid spheres are the only shoulder mass, so their
  size/placement *is* the shoulder silhouette. Anchoring the delt down the arm
  vector (lerp S→E) is pose-correct for free: down-arm lowers it, up-arm raises
  it.
- The body weld can use a much tighter k than it did because every body join
  except the arms is coaxial/end-to-end; only parallel-running limbs need the
  gap NOT bridged. One global knob fixed it without per-join special-casing.

## Longed for
- A tiny built-in A/B helper in `model:preview` (e.g. `--compare-git <ref>` that
  renders the same model at HEAD and a ref side-by-side) — I hand-rolled the
  stash→render→pop→sharp-montage dance, which is the common shape for "did my
  engine edit change the look, and how?"
