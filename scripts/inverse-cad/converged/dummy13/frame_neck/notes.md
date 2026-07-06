# frame_neck — session verdict (2026-07-03)

CONVERGED in 1 authored attempt (attempt 1). Score 0.0035, 6/6 MUST + 2/2 SHOULD.
chamfer 0.0004, hausdorff max 0.0029, P99 0.0016, IoU 0.9995, volume ratio 0.9997.

## Structure (all numbers probed, zero guesses)
- Joint balls r=3.000 at [0,0,0] and [0,10,0] (fit: r=3.0038 rms 0.017 -> kit-exact 3.0 used; section chords confirm r=3.0, center z=0).
- Mid bulge: exact sphere r=2.45 @ [0,5,0] (fit rms 0, inliers 1.0).
- Neck cylinder r=1.5 along Y, y 0..10, axis at z=0 (ray-down at (0,2.85) hit z=1.4997; NO chordal flat here, unlike the limb D-neck).
- Shaft: Y-prism y in [3,7], octagonal (x,z) profile: x=+/-1.5 for |z|<=2.2, 45 deg chamfers to +/-1.2 at z=+/-2.5 (ray ladder at y=5 confirmed exact 45 deg both top and bottom).
- Whole part clipped z >= -2.5 (build-plate flat; ball bottoms become r~1.658 circles).

## Strategy that worked
Pure primitive composition after ~4 probe calls (2 sphere fits, 1 bulge fit, section census, ray ladder). Bootstrap slice-stack (prismaticScore 0.18) was discarded entirely. Dummy 13 kit priors (§Dummy-13 note + §5.18 archetype) predicted almost everything; only the mid sphere r=2.45 and shaft octagon dims were new numbers.

## What next
Nothing — done. If re-baking, keep SEG=128 spheres (target is finely faceted).
