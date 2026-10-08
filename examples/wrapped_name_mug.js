// Personalized Mug — a hollow ceramic mug with a name embossed around the
// body using `api.wrapAround` (see /ai/deform.md). Customize the `word`
// param to change the lettering; everything else is fixed geometry.
const { Manifold, CrossSection } = api;

const p = api.params({
  word: { type: 'text', default: 'MAKER', maxLength: 10, label: 'Text on mug' },
});

api.material('ceramic'); // viewport-only shading preset; no effect on headless preview

// ---- Dimensions ----
const outerR = 16;
const wall = 2;
const innerR = outerR - wall;
const bodyHeight = 40;
const floorThickness = 3;
const segs = 96;

// ---- Body: hollow cylinder, open top, solid floor ----
const shell = Manifold.cylinder(bodyHeight, outerR, outerR, segs);
const cavity = Manifold.cylinder(bodyHeight - floorThickness + 1, innerR, innerR, segs)
  .translate([0, 0, floorThickness]);
let mug = shell.subtract(cavity);

// ---- Handle: a D-shaped tube swept along a half-circle arc on the back
// (+Y) side. The arc's endpoints sit inside the wall (y0 well short of
// outerR) so the tube solidly overlaps the shell and fuses in the union.
const armR = 3;              // handle tube radius
const loopR = 12;            // handle arc radius
const z0 = bodyHeight / 2;   // vertical center of the handle loop
// The arc's flat end caps lie in the plane y=y0 (constant y, x/z varying by
// armR) — so the whole cap's distance from the Z axis is >= y0. Keep y0
// inside the wall annulus [innerR, outerR] (not just "less than outerR") or
// the cap floats loose inside the hollow cavity instead of welding to the wall.
const y0 = innerR + 1;        // cap sits mid-wall (14+1=15, spread 15..~15.3), fully embedded
const handleProfile = CrossSection.circle(armR, 24);
const handle = api.sweepArc(handleProfile, {
  radius: loopR,
  angle: 180,
  startAngle: -90,
  plane: 'yz',
  center: [0, y0, z0],
  segments: 48,
});
mug = mug.add(handle);

// ---- Embossed name band, wrapped around the front (−Y) face, mid-height ----
const textHeight = 1.6;           // extrusion thickness -> embed/proud depth
const wrapRadius = outerR - 0.7;  // y=0 wrap plane sits ~0.7 inside the outer wall
let label = api.text(p.word, { size: 10, height: textHeight });
const bb = api.bbox(label);
const midY = (bb.min[1] + bb.max[1]) / 2;
label = label
  .rotate([90, 0, 0])                                   // letter-height -> Z, extrusion depth -> -Y
  .translate([-(bb.min[0] + bb.max[0]) / 2, 1.2, z0 - midY]); // center X, push outward, center on band height
const wrapped = api.wrapAround(label, { radius: wrapRadius });
const lettering = api.label(wrapped, 'lettering', { color: '#1d4ed8' });

return mug.add(lettering);
