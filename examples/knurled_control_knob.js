// Parametric control knob with a functional knurled grip, built with the
// api.knurl namespace. Switch the grip between a diamond cross-hatch, straight
// axial splines, or horizontal finger ribs, and choose how it mounts: a plain
// shaft bore, a D-shaft bore (flatted, for a potentiometer), or a heat-set
// threaded insert (composes api.fasteners). A pointer notch on the cap marks
// the position. Tune everything in the Customizer.
const { knurl, fasteners, Manifold } = api;

const p = api.params({
  style:    { type: 'select', default: 'diamond', options: ['diamond', 'straight', 'ribs'], label: 'Grip style' },
  diameter: { type: 'number', default: 26, min: 12, max: 50, step: 1, unit: 'mm', label: 'Diameter' },
  height:   { type: 'number', default: 16, min: 8,  max: 36, step: 1, unit: 'mm', label: 'Grip height' },
  pitch:    { type: 'number', default: 2.2, min: 1, max: 5, step: 0.1, unit: 'mm', label: 'Grip pitch' },
  depth:    { type: 'number', default: 0.8, min: 0.3, max: 2, step: 0.1, unit: 'mm', label: 'Grip depth' },
  mount:    { type: 'select', default: 'D-shaft', options: ['shaft', 'D-shaft', 'insert'], label: 'Mount' },
  shaftDia: { type: 'number', default: 6, min: 3, max: 12, step: 0.5, unit: 'mm', label: 'Shaft / insert size' },
  pointer:  { type: 'boolean', default: true, label: 'Pointer notch' },
});

const D = p.diameter, H = p.height;
const seg = 96;

// --- Grip: a knurled cylinder (solid core, ridges peak at D) ---
const gripOpts = { diameter: D, height: H, pitch: p.pitch, depth: p.depth, segments: seg };
const grip = knurl[p.style](gripOpts);

// --- Cap: a shallow domed top so the knob reads as finished, not cut off ---
const capH = Math.max(2.5, D * 0.12);
// Quarter-ellipse profile revolved into a dome (X = radius, Y = height).
const domePts = [[0, 0]];
const N = 24;
for (let i = 0; i <= N; i++) {
  const a = (Math.PI / 2) * (i / N);
  domePts.push([(D / 2) * Math.cos(a), capH * Math.sin(a)]);
}
domePts.push([0, capH]);
const dome = Manifold.revolve(new api.CrossSection([domePts]), seg, 360).translate([0, 0, H]);

let knob = grip.add(dome);

// --- Mount bore from the bottom (the knob core is already solid) ---
const boreDepth = H + capH - 2;
const r = p.shaftDia / 2;
if (p.mount === 'insert') {
  // Heat-set threaded insert: a melt-in bore sized from the metric table
  // (nearest of M3/M4/M5). The screw threads into the brass insert.
  const size = p.shaftDia <= 3.5 ? 'M3' : p.shaftDia <= 4.5 ? 'M4' : 'M5';
  const hole = fasteners.fastener(size).insert.hole;
  const bore = Manifold.cylinder(boreDepth, hole / 2, hole / 2, seg).translate([0, 0, -0.1]);
  knob = knob.subtract(bore);
} else {
  let bore = Manifold.cylinder(boreDepth, r, r, seg).translate([0, 0, -0.1]);
  if (p.mount === 'D-shaft') {
    // Flatten one side of the bore for a D-shaped potentiometer shaft: remove
    // the circular segment beyond a chord at distance `flat` from the axis.
    const flat = r * 0.7;
    const cut = Manifold.cube([D, r, boreDepth + 1], false).translate([-D / 2, flat, -0.5]);
    bore = bore.subtract(cut);
  }
  knob = knob.subtract(bore);
}

// --- Pointer notch on the cap ---
if (p.pointer) {
  const notch = Manifold.cube([1.6, D / 2, capH], false)
    .translate([-0.8, D / 4, H + capH - capH * 0.6]);
  knob = knob.subtract(notch);
}

return api.label(knob, 'knob', { color: '#3a4a5a' });
