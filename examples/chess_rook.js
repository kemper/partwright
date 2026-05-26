// Chess Rook (Castle) — uses CrossSection.ofPolygons + revolve for the body,
// boolean subtraction for crenellations and the hollow interior.
const { Manifold, CrossSection } = api;

// ---------------------------------------------------------------
// 1. BODY via revolve of a 2D profile
//    revolve() rotates around the Y axis, remapping so result is Z-up.
//    In the 2D profile: X = radial distance, Y = height.
//    After revolve, profile Y becomes 3D Z automatically.
// ---------------------------------------------------------------
// Outer silhouette profile (CCW winding).
// Traces from center-bottom, out to base, up the body, across top, back to center.
const profile = [
  // Bottom center to base flare
  [0, 0],          // center bottom
  [6.0, 0],        // base outer edge (flat bottom)
  [6.0, 0.8],      // base outer lip
  [5.2, 1.5],      // base narrows inward
  [4.8, 2.5],      // base-to-body transition

  // Body — slight taper upward
  [4.5, 3.5],      // lower body
  [4.2, 7.0],      // mid body
  [4.0, 10.0],     // upper body
  [3.8, 12.0],     // near top of shaft

  // Collar / platform that flares out before crenellations
  [3.8, 13.0],     // start of collar
  [4.8, 13.5],     // collar flares outward
  [5.0, 14.0],     // collar top outer edge
  [5.0, 16.0],     // top of parapet wall

  // Close back to center axis at top
  [0, 16.0],       // center top
];

const outerCS = CrossSection.ofPolygons([profile]);
const body = Manifold.revolve(outerCS);

// ---------------------------------------------------------------
// 2. HOLLOW INTERIOR
//    Subtract a revolved interior profile to hollow out the piece.
//    Leave a solid floor at the base.
// ---------------------------------------------------------------
const interiorProfile = [
  [0, 1.5],        // floor at y=1.5 (solid base below)
  [3.2, 1.5],      // interior wall radius at bottom
  [3.0, 7.0],      // slight taper inward
  [2.8, 12.0],     // narrower near top
  [3.0, 13.0],     // widens into collar area
  [3.5, 14.0],     // interior of collar
  [3.5, 17.0],     // extends above top to open it
  [0, 17.0],       // center top
];

const interiorCS = CrossSection.ofPolygons([interiorProfile]);
const interior = Manifold.revolve(interiorCS);

const hollowBody = body.subtract(interior);

// ---------------------------------------------------------------
// 3. CRENELLATIONS (battlements)
//    Cut rectangular notches from the top parapet wall.
//    The rook stands along Z (revolve maps profile Y → 3D Z).
//    The parapet spans Z=14 to Z=16.
//    5 crenels (gaps), evenly spaced around the circle.
// ---------------------------------------------------------------
const numCrenels = 5;
const crenelH = 2.0;           // full height of parapet to cut through
const crenelZ = 14.0;          // bottom of parapet

// Angular width of each gap: half of each segment (merlon + crenel = 1 segment)
const crenelAngularWidth = 360 / (numCrenels * 2); // 36 degrees per crenel
const crenelAngularWidthRad = (crenelAngularWidth * Math.PI) / 180;

// Radial depth — must span from inner wall (~3.5) to beyond outer wall (~5.0)
const radialInner = 2.5;
const radialOuter = 6.0;
const radialDepth = radialOuter - radialInner;

let crenelCuts = [];
for (let i = 0; i < numCrenels; i++) {
  const angle = (i * 360) / numCrenels;

  // Arc width at the outer radius
  const arcWidth = 2 * radialOuter * Math.sin(crenelAngularWidthRad / 2);

  // Create a box that cuts through the wall
  const block = Manifold.cube([radialDepth, arcWidth, crenelH + 0.1])
    .translate([radialInner, -arcWidth / 2, crenelZ - 0.05])
    .rotate([0, 0, angle]);

  crenelCuts.push(block);
}

const crenelUnion = Manifold.union(crenelCuts);
const rook = hollowBody.subtract(crenelUnion);

return rook;
