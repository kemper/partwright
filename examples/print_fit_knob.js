// Tightening knob with a captive nut — a knurled hand knob you thread onto
// a bolt or rod. Drop a hex nut into the pocket in the base; it's captured by
// the pocket walls so turning the knob turns the bolt. No tools, no spinning nut.
// Useful for jigs, clamps, adjustable feet, and printer mods. Fully parametric.
const { Manifold, printFit, circularPattern } = api;

const p = api.params({
  diameter:  { type: 'number', default: 32, min: 20, max: 60, step: 2,   unit: 'mm', label: 'Knob diameter' },
  height:    { type: 'number', default: 14, min: 8,  max: 30, step: 1,   unit: 'mm', label: 'Knob height' },
  screwSize: { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'], label: 'Screw size' },
  lobeCount: { type: 'int',    default: 7,  min: 4,  max: 16,             label: 'Grip lobes' },
});

const knobR = p.diameter / 2;
const knobH = p.height;
const lobeR = Math.max(2.4, knobR * 0.2);

// ---- Knob body with scalloped finger-grip lobes ----
let body = Manifold.cylinder(knobH, knobR, knobR, 64);
const lobe = Manifold.cylinder(knobH + 2, lobeR, lobeR, 24).translate([knobR, 0, -1]);
body = body.subtract(circularPattern(lobe, p.lobeCount, { axis: 'z' }));

// Chamfer the top rim with a cone intersect.
const topChamfer = Manifold.cylinder(2.5, knobR + 3, knobR - 1.5, 64).translate([0, 0, knobH - 2.5]);
body = body.intersect(
  Manifold.cylinder(knobH - 2.5, knobR + 5, knobR + 5, 64).add(topChamfer),
);

// ---- Captive nut pocket in the base, opening downward ----
// nutPocket mouth at z=0 descends -Z; rotate 180° so it opens through the base.
const nut = printFit.nutPocket({ size: p.screwSize, captive: true, depth: 4 })
  .rotate([180, 0, 0]);
body = body.subtract(nut);

// ---- Clearance bore all the way through for the bolt ----
// Place the screwHole entrance at z=knobH (top) so it drills down through the knob.
body = body.subtract(
  printFit.screwHole({ size: p.screwSize, length: knobH, head: 'none', through: true })
    .translate([0, 0, knobH]),
);

return api.label(body, 'knob', { color: '#5a9367' });
