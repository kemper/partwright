// Twisted Checker Vase — a rounded-square vessel spiraled with api.twist,
// flared with api.taper, and finished in a two-tone 3D checkerboard via
// api.paint.pattern. One hollow, open-top, print-in-place solid.
const { geom } = api;

const WALL = 2.5;       // vessel wall thickness
const HEIGHT = 70;      // overall body height
const FLOOR = 3;        // solid base thickness (keeps the bottom sealed)
const OUTER_W = 28;     // outer square footprint (width == height, rounded)
const OUTER_R = 6;      // outer corner rounding radius
const SEGMENTS = 28;    // corner segments — plenty of resolution for crisp checker cells

// Outer + inner rounded-square profiles, both centered on the origin so the
// later twist (which rotates about the world x=y=0 axis line) stays symmetric.
const outerProfile = geom.roundedRect(OUTER_W, OUTER_W, OUTER_R, SEGMENTS);
const innerW = OUTER_W - 2 * WALL;
const innerR = Math.max(OUTER_R - WALL, 0.5);
const innerProfile = geom.roundedRect(innerW, innerW, innerR, SEGMENTS);

// Extrude with enough vertical divisions that the twist/taper warps (which
// auto-refine further) start from an already-decent mesh.
const nDiv = Math.round(HEIGHT / 1.2);
const outerSolid = outerProfile.extrude(HEIGHT, nDiv);

// Cavity: starts above the floor and pokes through the top so the vase stays
// open (a vessel, not a sealed block).
const cavityHeight = HEIGHT - FLOOR + 2;
const innerCavity = innerProfile.extrude(cavityHeight, nDiv).translate([0, 0, FLOOR]);

let vase = outerSolid.subtract(innerCavity);

// Spiral the whole body 120° about the world Z axis...
vase = api.twist(vase, { degrees: 120, axis: 'z' });
// ...then flare it: narrower at the base, wider at the rim.
vase = api.taper(vase, { scaleBottom: 0.85, scaleTop: 1.25, axis: 'z' });

// The twist stretches triangles tangentially, and the checker assigns ONE
// color per triangle (centroid test) - long stretched slivers turn cell
// boundaries into jagged teeth. A post-deform refine pass splits exactly the
// stretched edges back to ~1 unit, so the painted boundary tracks the true
// cell edge far more closely (at ~2.5x the triangle count).
vase = vase.refineToLength(1.0);

// Two-tone 3D checkerboard over the whole surface (inside and out) — each
// triangle stays one flat color, so it's multi-material-printable as-is.
api.paint.pattern({
  pattern: 'checker',
  colors: ['#1d4ed8', '#fbbf24'],
  scale: 9,
});

return vase;
