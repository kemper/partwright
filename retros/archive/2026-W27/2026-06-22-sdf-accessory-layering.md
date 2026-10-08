# Retro — SDF accessory layering (conform + occlude)

Date: 2026-06-22
Context: showcase-figure review fixes (#840, PR #830) — belt wrapped the arms,
necklace jutted across the gown, sword held palm-down.

## Liked
- The user's framing ("we haven't defined a concept of layers for SDF") pointed
  straight at the root cause. Naming it turned three one-off bugs into one
  reusable primitive: **conform to a base surface + subtract the occluders in
  front of it.** Pose-reactive for free (belt re-wraps when arms lift because the
  arms simply aren't at the waist — no arm-up/arm-down branching).
- The smooth headless rasterizer + tight crops made the grip/belt/necklace defects
  obvious and the fixes verifiable in 1–2 renders each.

## Lacked
- I shipped the showcase figures with these defects because I only checked
  front/iso at figure scale — the belt-around-arms and palm-down grip are obvious
  the moment you crop the waist/hand. A "zoom each accessory region" pass should
  be standard before declaring an accessory figure done.
- `taper` is anchored at z=0 (scales about the origin), which silently flares a
  centred box's far end — cost a couple of iterations on the sword blade. Worth a
  one-line note in the sdf docs.

## Learned
- `holdAt` must bind TWO axes (long axis + palmNormal) to control roll; one-axis
  alignment leaves a prop free to roll to palm-down.
- `subtract` does NOT shrink a node's analytic bounds — assert occlusion via
  `evaluate`, not `bounds()` (caught a wrong unit test).
- Geometric subtraction beats a label-priority compositor when the failure is
  geometric (a band physically ballooning), not just colouring.

## Longed for
- A first-class layer/occlusion concept on the accessory verbs is now in
  (`occlude`/`rig`); a *global* figure layer-order (skin < clothing < jewelry <
  drape) that auto-derives occluders for ALL accessories would remove the last
  bit of per-call wiring.
