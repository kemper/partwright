// SDF bloom — a stylised flower that shows off the follow-up combinators.
//
// - petals: an ELLIPSOID (the squashed sphere uniform .scale() can't make)
//   tilted outward, then POLAR-ARRAYED into a ring of 8 — no hand-written
//   per-petal coordinates, just `.polarArray(8, ...)`.
// - centre: a flattened ellipsoid pollen dome, smooth-welded so the petals
//   appear to grow out of it.
// - stem: a slender TAPERed column (narrows toward the top) capped under
//   the bloom.
//
// Three labelled regions drive the paint manifest (petals / centre / stem).
const { sdf } = api;

// --- Petals: one ellipsoid, tilted out, repeated 8x around Z ----------
// A single petal: a flat, elongated ellipsoid lying along +X, lifted to
// the bloom height and tipped up ~35° so the ring forms a shallow cup.
const petal = sdf.ellipsoid(9, 3.2, 1.1)
  .translate(9, 0, 0)        // push out so the inner tip sits near the centre
  .rotate(0, -35, 0)         // tilt the outer edge upward
  .translate(0, 0, 24);      // raise to the top of the stem

// polarArray welds 8 rotated copies into one ring — the whole array is a
// single paint region, so label it once on the result.
const petals = petal.polarArray(8, { axis: 'z' }).label('petals');

// --- Centre: a flattened pollen dome ----------------------------------
const centre = sdf.ellipsoid(5, 5, 3)
  .translate(0, 0, 24)
  .label('centre');

// --- Stem: a column that tapers thinner toward the bloom --------------
// Negative taper along Z narrows the cross-section as z increases.
const stem = sdf.roundedCylinder(2.2, 24, 0.8)
  .taper(-0.02, 'z')
  .translate(0, 0, 12)
  .label('stem');

// Hard-union the three labelled regions (smooth blends are kept WITHIN
// each region; the seams between them sit where you can't see them).
return sdf.union(petals, centre, stem).build({ edgeLength: 0.4 });
