// Geodesic lantern — faceted dome shell with patterned window cutouts,
// a flat base, and a small spire finial on top.
//
// Design intent (Z-up, mm):
//   - Flat faceted disk base (z=0..3), ~32mm across, for stability.
//   - Hollow faceted dome: low-segment sphere minus an inner sphere with a
//     raised floor, giving a ~2.5mm wall and a solid floor. The dome's
//     flat bottom overlaps the base by ~0.8mm so they boolean-union cleanly.
//   - Two rings of cylindrical "window" cutouts arranged with
//     `circularPattern`. Each cutter is a long horizontal cylinder
//     centered on the lantern's vertical axis — pairs of opposing cutters
//     in the ring jointly punch through both sides of the shell, giving
//     N windows around (one per cutter copy).
//   - A small bead + spire finial sits atop the dome via `placeOn`.
//   - `expectUnion` / `expectDifference` assertions catch silent boolean
//     failures (e.g. a window cylinder that misses the shell).
//
// Trace of correctness:
//   - hollowDome: outerSphere(r=14) − cutoffPlate − raisedInnerSphere
//     → upper-hemisphere shell, one component.
//   - Lower ring (8 cutters at local z=4.8): inner-sphere radius at that
//     latitude ≈ √(11.5² − 4.8²) ≈ 10.4; outer ≈ √(14² − 4.8²) ≈ 13.1.
//     Cutter spans x = 0..16, so it intersects the near wall and exits.
//     The opposite copy of the cutter (180° away) handles the far wall —
//     so 8 cutters give 8 windows total around the equator.
//   - Upper ring (6 cutters at local z=10.8): outer-sphere radius there
//     ≈ √(14² − 10.8²) ≈ 8.9. Cutter still spans x = 0..16, so it always
//     reaches the wall regardless of latitude. Half-step (30°) rotated.

const { Manifold } = api;

// --- Dimensions ----------------------------------------------------------
const baseR = 16;
const baseH = 3;
const bodyR = 14;
const wall  = 2.5;
const bodySeg = 24;       // faceted-but-readable sphere segmentation

// --- Base ---------------------------------------------------------------
// Slightly tapered 12-gon disk so it reads as faceted, not lathed.
const base = Manifold.cylinder(baseH, baseR, baseR * 0.92, 12);

// --- Hollow dome --------------------------------------------------------
const outerSphere = Manifold.sphere(bodyR, bodySeg);
const innerSphere = Manifold.sphere(bodyR - wall, bodySeg);

// Large plate whose top face sits at z=0 — used to chop off lower hemispheres.
const cutoffPlate = Manifold.cube([bodyR * 3, bodyR * 3, bodyR * 2], true)
  .translate([0, 0, -bodyR]);

const outerDome = outerSphere.subtract(cutoffPlate);                  // z: 0..14
// Lift inner cavity above the floor (gives a solid base) AND shift it down
// a touch from the outer apex (z=14) so the dome keeps a small solid cap.
// Without the cap, the finial we place on top has no material to weld to and
// expectUnion at the very end catches it as a floating component.
const capThickness = 1.5;
const innerCavity = innerSphere.subtract(cutoffPlate)                 // z: 0..11.5
  .translate([0, 0, wall - capThickness]);                            // z: 1..12.5 — leaves cap at z=12.5..14

const hollowDome = api.expectDifference(outerDome, innerCavity, { expectNonEmpty: true });

// Sink dome 0.8mm into the base for a solid weld (placeOn with negative gap).
const dome = api.placeOn(hollowDome, base, { gap: -0.8 });

// --- Window cutters -----------------------------------------------------
// A cutter is a horizontal cylinder along +X spanning x = 0..16, lying at
// height `zLocal` measured from the dome's pre-place flat bottom. We then
// shift it up by the same offset placeOn applied, so it lines up.
const domeBox = api.bbox(dome);
const domeFlatBottomZ = domeBox.min[2];   // world Z of the dome's flat bottom

function radialWindow(zLocal, holeR, segments) {
  const length = bodyR + 2;               // far enough to clear the outer wall
  return Manifold.cylinder(length, holeR, holeR, segments)
    .rotate([0, 90, 0])                   // axis +Z → axis +X (x ∈ 0..length)
    .translate([0, 0, domeFlatBottomZ + zLocal]);
}

// Lower ring: 8 windows around the equator. zLocal=4.8 → near the widest belt.
const lowerCutter = radialWindow(/*zLocal*/ 4.8, /*r*/ 2.6, 16);
const lowerRing = api.circularPattern(lowerCutter, 8);

// Upper ring: 6 smaller windows, offset by 30° so they nest between lower ones.
const upperCutter = radialWindow(/*zLocal*/ 10.8, /*r*/ 1.6, 14)
  .rotate([0, 0, 30]);
const upperRing = api.circularPattern(upperCutter, 6);

const allCutters = Manifold.union([lowerRing, upperRing]);

const litDome = api.expectDifference(dome, allCutters, { expectNonEmpty: true });

// --- Finial: faceted bead + tapered spire -------------------------------
const bead = Manifold.sphere(2.6, 12);
const spire = Manifold.cylinder(7, 1.1, 0.1, 8);

const finialCore = api.expectUnion(
  [bead, api.placeOn(spire, bead, { gap: -0.5 })],
  { expectComponents: 1 },
);

// placeOn handles the apex math — sink 0.6mm for a solid union.
const finial = api.placeOn(finialCore, litDome, { gap: -0.6 });

// --- Final assembly -----------------------------------------------------
const lantern = api.expectUnion([base, litDome, finial], { expectComponents: 1 });

return lantern;
