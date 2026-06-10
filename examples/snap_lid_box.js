// Snap-lid round container — a cylindrical box whose press-on lid clicks shut.
// A bead ring runs around the lid's skirt and snaps into a matching groove cut
// inside the box mouth; both come from ONE api.joints.snapRim call, so they
// land on exactly the same interface diameter. Print the lid cap-down beside
// the body; the thin skirt flexes as the bead rides past the rim and clicks in.
const { Manifold, joints } = api;

const p = api.params({
  diameter:  { type: 'number', default: 50,   min: 25,  max: 100, step: 5,    unit: 'mm', label: 'Outer diameter' },
  height:    { type: 'number', default: 40,   min: 15,  max: 100, step: 5,    unit: 'mm', label: 'Body height' },
  wall:      { type: 'number', default: 2.4,  min: 1.6, max: 4,   step: 0.2,  unit: 'mm', label: 'Wall / floor' },
  lidHeight: { type: 'number', default: 11,   min: 7,   max: 20,  step: 1,    unit: 'mm', label: 'Lid height' },
  beadD:     { type: 'number', default: 1.2,  min: 0.6, max: 2.4, step: 0.1,  unit: 'mm', label: 'Bead diameter' },
  clearance: { type: 'number', default: 0.15, min: 0,   max: 0.4, step: 0.05, unit: 'mm', label: 'Snap clearance' },
});

const R = p.diameter / 2;          // body outer radius
const boreR = R - p.wall;          // body inner radius = the snap interface
const capT = 3;                    // lid cap thickness
const skirtWall = 1.6;             // thin so it flexes over the bead
const skirtLen = p.lidHeight - capT;
const beadUp = 1.5;                // bead centreline distance up from the skirt's free edge
const LIP = 0.1;

// ONE snapRim call -> bead + groove on the SAME interface diameter (the bore).
const { bead, groove } = joints.snapRim({
  diameter: boreR * 2,
  beadD: p.beadD,
  clearance: p.clearance,
});

// ---- Body: cylindrical cup, groove cut into the inner wall near the mouth ---
// When the lid seats (cap resting on the rim), the bead sits `seatDepth` below
// the rim — cut the groove exactly there.
const seatDepth = skirtLen - beadUp;
let body = Manifold.cylinder(p.height, R, R, 96)
  .subtract(Manifold.cylinder(p.height - p.wall + LIP, boreR, boreR, 96).translate([0, 0, p.wall]))
  .subtract(groove.translate([0, 0, p.height - seatDepth]));

// ---- Lid: printed cap-down — flat cap with a thin skirt rising from it ------
// The skirt's OUTER face sits on the bore diameter; the bead ring is unioned
// onto it half-proud, `beadUp` below the free edge (= top, as printed).
let lid = Manifold.cylinder(capT, R, R, 96)
  .add(
    Manifold.cylinder(skirtLen + 0.5, boreR, boreR, 96)
      .subtract(Manifold.cylinder(skirtLen + 0.5 + 2 * LIP, boreR - skirtWall, boreR - skirtWall, 96).translate([0, 0, -LIP]))
      .translate([0, 0, capT - 0.5]), // sink 0.5 into the cap so the union fuses
  )
  .add(bead.translate([0, 0, p.lidHeight - beadUp]));

// Lay the lid beside the body for printing.
return api.label(body, 'body', { color: '#3f7f8c' })
  .add(api.label(lid.translate([p.diameter + 12, 0, 0]), 'lid', { color: '#d09a4e' }));
