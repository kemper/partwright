// Tightening knob with a captive M4 nut — a knurled hand knob you thread onto
// an M4 bolt or rod. A hex nut drops into the captive pocket in the base and is
// trapped, so turning the knob turns the bolt: no tools, no spinning nut.
// Useful for jigs, clamps, adjustable feet, and printer mods.
const { Manifold, printFit, circularPattern } = api;

const knobR = 16;     // knob radius
const knobH = 14;     // knob height
const lobeR = 3.2;    // finger-grip lobe radius
const lobeN = 7;      // number of grip lobes

// ---- Knob body: a cylinder with finger lobes around the rim ----
let body = Manifold.cylinder(knobH, knobR, knobR, 64);
// Scalloped grip: subtract a ring of lobe cylinders around the edge.
const lobe = Manifold.cylinder(knobH + 2, lobeR, lobeR, 24).translate([knobR, 0, -1]);
body = body.subtract(circularPattern(lobe, lobeN, { axis: 'z' }));

// Round the top edge a touch by intersecting with a slightly domed cap — keep
// it simple: chamfer the top rim with a cone subtract.
const topChamfer = Manifold.cylinder(2.5, knobR + 3, knobR - 1.5, 64).translate([0, 0, knobH - 2.5]);
body = body.intersect(
  Manifold.cylinder(knobH - 2.5, knobR + 5, knobR + 5, 64)
    .add(topChamfer),
);

// ---- Captive M4 nut pocket in the base, opening downward ----
// nutPocket opens at z=0 going -Z with a +LIP overpoke up top. Flip 180° about X
// so the mouth opens downward through the base face (z=0) and the cavity sits
// inside the knob (z = 0..nut height). The captive slot lets the nut slide in.
const nut = printFit.nutPocket({ size: 'M4', captive: true, depth: 4 })
  .rotate([180, 0, 0]);
body = body.subtract(nut);

// ---- Clearance hole all the way through for the bolt/rod ----
// screwHole drills from its z=0 entrance down to z=-length; place the entrance
// at the top (z=knobH) so the bore runs the full height and `through` clears the
// base into the nut pocket.
body = body.subtract(
  printFit.screwHole({ size: 'M4', length: knobH, head: 'none', through: true })
    .translate([0, 0, knobH]),
);

return api.label(body, 'knob', { color: '#5a9367' }); // muted green
