// Aetherjelly — a radially-symmetric drifter that exists because of the
// new SDF combinators. The whole shape is built by composing four kinds
// of symmetry rather than by hand-placing copies:
//
//   - .polarArray(...) builds the ring of tapered tentacles and the
//     crown of bead-like ocelli on top.
//   - .mirrorPair('x') reflects a single rear fin across the body axis
//     into a left/right pair (the bilateral counter-point to all the
//     radial stuff).
//   - .ellipsoid(rx, ry, rz) shapes the flattened jellybell body — the
//     "squashed sphere" .scale() can't make — and is reused for the
//     bead in each ocellus and the lobed fin.
//   - .taper(rate, 'z') narrows each tentacle toward the tip and
//     narrows the central foot-pillar.
//
// Painting plan: a polarArray welds N copies into ONE region (`.label`
// goes on the seed BEFORE arraying, because there's no per-copy label),
// so we get exactly three paint regions: the bell+foot body, the ring
// of tentacles+rear fins, and the crown of ocellus beads.
const { sdf } = api;

// --- Bell: a flattened ellipsoid dome --------------------------------
// rx=ry=11, rz=5 — wider than it is tall, the classic jellyfish cap.
// This is the gap ellipsoid closes: uniform .scale() would shrink it
// uniformly, and the pre-combinator workaround was a sphere clipped by
// a box. Now it's one call.
const bell = sdf.ellipsoid(11, 11, 5).translate(0, 0, 6);

// --- Foot: tapered central pillar hanging under the bell -------------
// A roundedCylinder narrowed toward -z with .taper. The taper rate is
// negative-along-z and the cylinder is centred at z = -6, so at its
// bottom (z = -12) the cross-section is scaled by 1 + (-0.04)*(-12) =
// 1.48 — i.e. it FLARES outward at the bottom into a little anchor
// foot. Reading the docs once was enough: "scale=1 at origin, positive
// rate widens toward +axis" → negative rate widens toward -axis.
const foot = sdf.roundedCylinder(2.4, 12, 0.8)
  .taper(-0.04, 'z')
  .translate(0, 0, -6);

// Body is bell smooth-welded to foot so the seam disappears. Label the
// OUTER smoothUnion (smooth booleans don't propagate inner labels) so
// the whole organic blend paints as one region.
const body = bell.smoothUnion(foot, 2.0).label('body');

// --- Tentacles: a polarArray of tapered capsules ---------------------
// One tentacle = a capsule from the underside of the bell out and down,
// then tapered so it narrows toward the tip. polarArray(8) welds 8
// rotated copies around Z into ONE region. Reaching for the `radius`
// option of polarArray was tempting, but the tentacle already starts at
// a specific x = 9 anchor point on the bell — pre-translating the
// capsule itself was clearer than letting polarArray do the push.
const tentacle = sdf.capsule([9, 0, 4], [16, 0, -10], 1.4)
  .taper(-0.05, 'z');

// --- Rear fins: a mirrorPair across X (the bilateral counterpoint) ---
// Two flat lobed ellipsoids sticking out from the back, made by
// modelling ONE on the +y side and mirrorPair'ing across x. mirrorPair
// is the new shortcut: just a one-liner instead of `node.union(node
// .mirror('x'))`. (For reference, .mirror() alone still exists for
// when you want JUST the mirror image; mirrorPair is the symmetric
// case, which is what we want here.)
const finOne = sdf.ellipsoid(5, 1.6, 3.5)
  .rotate(0, 25, 0)            // tip back-and-up
  .translate(11, 6, -2);       // anchor at the +x +y rear flank
const fins = finOne.mirrorPair('x');

// Tentacles + fins share the "limbs" paint region — different paint
// chunks per limb-type would require labelling BEFORE the polarArray,
// and even then every copy in a ring shares the same label, so two
// regions is the most expressive split available.
const limbs = tentacle.polarArray(8, { axis: 'z' })
  .union(fins)
  .label('limbs');

// --- Crown: polarArray of small ellipsoid beads (ocelli) -------------
// Six tiny eyespots ringing the top of the bell. Here we DO use the
// `radius` option of polarArray — the seed bead lives at the origin and
// polarArray pushes it out by 8 along +x before rotating. This was
// the spot where the `{axis, angle, radius}` options shape felt right:
// I didn't want to pre-translate because then I'd have to re-derive the
// ring radius myself.
const ocellus = sdf.ellipsoid(1.5, 1.5, 0.9)
  .translate(0, 0, 10.5);      // sit on top of the bell at z ≈ 10.5
const crown = ocellus.polarArray(6, { axis: 'z', radius: 8 })
  .label('crown');

// --- Final assembly --------------------------------------------------
// Hard-union the three labelled regions. The seams between body/limbs/
// crown are intentional paint boundaries; smooth blends are kept
// WITHIN each region (the bell↔foot weld inside `body`).
return sdf.union(body, limbs, crown).build({ edgeLength: 0.45 });
