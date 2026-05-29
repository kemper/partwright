// Blobbo — a cute alien blob creature built entirely from SDF primitives.
//
// Why SDF: the whole creature is one continuous smooth-blended body —
// head fused into torso, four tendrils flowing out the bottom, a stalk
// antenna welded on top. Doing this in mesh CSG would require a manual
// fillet pass at every joint; here smoothUnion gives us a single
// gummy-bear silhouette in a handful of lines.
//
// Painting plan: the body+tendrils+antenna-stalk become ONE smooth
// region wrapped in label('body'). The eye whites and pupils are
// hard-unioned on top with their own labels, so each paints separately.
// Smooth booleans don't propagate labels (see sdf.md), so anything
// inside the smooth blend gets the outer label.
const { sdf } = api;

// --- Body + head: one smooth peanut-shape ----------------------------
// A larger lower ball (belly) and a slightly smaller upper ball (head),
// welded with a generous k so they read as one organism, not two balls.
const belly = sdf.sphere(9).translate(0, 0, 0);
const head  = sdf.sphere(7).translate(0, 0, 11);
let creature = belly.smoothUnion(head, 4);

// --- Four tendrils flowing out of the belly --------------------------
// Each is a capsule from a point on the belly's lower hemisphere out and
// down into a curl. smoothUnion with a moderate k makes them grow out of
// the body like fingers of putty rather than glued-on sticks.
const tendrilK = 2.5;
const tendrilR = 1.6;
const tendrilSpecs = [
  // [start, end] — start is on the belly, end is the tip of the tendril.
  [[ 6,  6, -3], [ 11,  10, -12]],
  [[-6,  6, -3], [-11,  10, -12]],
  [[ 6, -6, -3], [ 11, -10, -12]],
  [[-6, -6, -3], [-11, -10, -12]],
];
for (const [a, b] of tendrilSpecs) {
  const tendril = sdf.capsule(a, b, tendrilR);
  creature = creature.smoothUnion(tendril, tendrilK);
}

// --- Antenna stalk: a thin capsule sprouting from the head -----------
// The bobble at the tip is a SEPARATE labelled region below — only the
// stalk fuses into the body here.
const antennaStalk = sdf.capsule([0, 0, 17], [1.5, 0, 23], 0.6);
creature = creature.smoothUnion(antennaStalk, 1.2);

// --- Cheek dimples: smooth-subtract two little pockets ---------------
// Demonstrates smoothSubtract giving soft, organic indents instead of
// crisp drilled holes. These have to be applied BEFORE the .label()
// wrap: smoothSubtract is a 2-child node (A and B) so it doesn't
// propagate an inner label up, unlike sharp subtract which exposes
// only its A side (sdf.md label rules). Labelling the OUTER result
// captures the whole blend cleanly.
const dimpleL = sdf.sphere(2.2).translate(-5.5, -5.5, 10);
const dimpleR = sdf.sphere(2.2).translate( 5.5, -5.5, 10);
const body = creature
  .smoothSubtract(dimpleL, 0.8)
  .smoothSubtract(dimpleR, 0.8)
  .label('body');

// --- Eyes: whites + pupils, two distinct paint regions ---------------
// Hard-unioned to the body (and to each other) so each carries its own
// label cleanly. The eyes poke slightly OUT of the head so the seam is
// crisp and recognizable as eyeballs, not painted spots.
const eyeL = sdf.sphere(2.6).translate(-3.2, -5.8, 12.5);
const eyeR = sdf.sphere(2.6).translate( 3.2, -5.8, 12.5);
const eyes = sdf.union(eyeL, eyeR).label('eye');

const pupilL = sdf.sphere(1.1).translate(-3.5, -7.6, 12.3);
const pupilR = sdf.sphere(1.1).translate( 3.5, -7.6, 12.3);
const pupils = sdf.union(pupilL, pupilR).label('pupil');

// --- Antenna bobble: separate label for a contrasting tip dot --------
const bobble = sdf.sphere(1.4).translate(1.5, 0, 24).label('antenna');

// --- Final assembly ---------------------------------------------------
// Hard-union the labelled regions together. Smooth blends are preserved
// WITHIN each label; the seams between labels are sharp but hidden
// behind eye-on-face geometry where you can't see them anyway.
const blobbo = sdf.union(body, eyes, pupils, bobble);

// edgeLength 0.5 — the creature spans roughly z=[-13, 25], xy~[-12, 12],
// so this gives a smooth surface without taking forever to mesh.
return blobbo.build({ edgeLength: 0.5 });
