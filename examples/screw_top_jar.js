// Parametric screw-top jar — a watertight container with a matching screw-on
// lid. The neck has real external threads (api.threads.rod) and the lid gets
// matching internal threads by subtracting a slightly-oversized threaded rod
// (the "tap" trick), plus a knurled grip. Resize freely; the threads always
// match. Print body + lid; they screw together.
const { Manifold, threads, circularPattern, labeledUnion } = api;

const p = api.params({
  diameter:  { type: 'number', default: 44, min: 24, max: 90, step: 2,   unit: 'mm', label: 'Body diameter' },
  height:    { type: 'number', default: 50, min: 20, max: 120, step: 5,  unit: 'mm', label: 'Body height' },
  wall:      { type: 'number', default: 3,  min: 2,  max: 6,  step: 0.5, unit: 'mm', label: 'Wall thickness' },
  pitch:     { type: 'number', default: 4,  min: 2,  max: 6,  step: 0.5, unit: 'mm', label: 'Thread pitch' },
  clearance: { type: 'number', default: 0.4, min: 0.2, max: 0.8, step: 0.1, unit: 'mm', label: 'Thread fit clearance' },
  knurls:    { type: 'int',    default: 28, min: 12, max: 48,             label: 'Lid grip flutes' },
});

const bodyR = p.diameter / 2;
const innerR = bodyR - p.wall;
const neckH = Math.max(3 * p.pitch, 10);   // a few threads of engagement

// ---- Jar body: smooth barrel + threaded neck, then hollowed out ----
const barrel = Manifold.cylinder(p.height, bodyR, bodyR, 96);
const neck = threads.rod({ diameter: p.diameter, pitch: p.pitch, length: neckH })
  .translate([0, 0, p.height]);
let jar = barrel.add(neck);
// Hollow from just above the base up through the open neck.
const cavity = Manifold.cylinder(p.height + neckH, innerR, innerR, 96).translate([0, 0, p.wall]);
jar = jar.subtract(cavity);

// ---- Lid: capped cylinder, internal threads tapped by subtraction, knurled ----
const lidR = bodyR + p.wall;
const lidH = neckH + p.wall;
let lid = Manifold.cylinder(lidH, lidR, lidR, 96);
// Tap internal threads: subtract an oversized rod (open at the bottom face).
const tap = threads.rod({ diameter: p.diameter + 2 * p.clearance, pitch: p.pitch, length: neckH + 1, chamfer: false });
lid = lid.subtract(tap);
// Knurled grip: scallop the rim with a ring of flutes.
const flute = Manifold.cylinder(lidH + 2, 1.6, 1.6, 16).translate([lidR, 0, -1]);
lid = lid.subtract(circularPattern(flute, p.knurls, { axis: 'z' }));
lid = lid.translate([p.diameter + 24, 0, 0]);

return labeledUnion([
  { name: 'jar', shape: jar, color: '#5fa8d3' },
  { name: 'lid', shape: lid, color: '#ef8354' },
]);
