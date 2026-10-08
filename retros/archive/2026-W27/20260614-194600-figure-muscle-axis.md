# Retro — figure muscle-definition axis

**Task:** add a `muscle` axis to the SDF figure rig (anatomical muscle masses) + 2 full-body catalog figures. PR #668.

## Liked
- The rig's frame-derived hinge made the "which way does a biceps bulge" problem fall out cleanly: the flexor side is just `hinge × boneDir` (the bend-rotation's derivative). Anchoring muscle to the same frames the pose uses means it tracks any pose for free — the whole point of the builder.
- The calibration-anchor pattern the anthropometry PR established (default = byte-identical, pinned by unit tests) made adding a big new axis low-risk: gate on `muscle > 0`, done.

## Lacked
- No way to verify the `paintByLabel`-resolves-to-0-triangles failure (eyes swallowed by the head) short of a full xvfb bake — `model:preview` shades by normal and doesn't run paint-by-label, so a face-geometry regression only surfaced at bake time, two cycles in. A headless paint-by-label resolution check (even just label→triangle-count) would catch "buried eyes" before the slow bake.

## Learned
- `F.clothing.pants` `cuffZ` can't make mid-thigh shorts — the leg sleeve always covers the knee (cuff projects onto the knee→ankle bone, clamped). For short shorts use `length: 'briefs'`. Cost ~1 bake cycle.
- bbox volume is NOT a reliable monotonic proxy for "added mass": the AABB saturates once an extreme point stops moving while interior mass keeps growing. Visual confirmation (render) is the real check; the unit test only safely asserts `m>0` vs `m=0`.

## Longed for
- A one-call "figure smoke bake" that renders + paint-by-label-resolves + reports tri count/genus/manifold without the xvfb headed-Chromium round trip. The bake is the only place several whole classes of figure bug (0-triangle paint labels, genus spikes from carves) become visible, and it's the slowest tool in the loop.
