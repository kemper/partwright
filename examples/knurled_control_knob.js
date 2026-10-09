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
  shaftDia: { type: 'number', default: 6, min: 3, max: 12, step: 0.5, unit: 'mm', label: 'Shaft dia / insert screw size' },
  clearance: { type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.05, unit: 'mm', label: 'Bore print clearance (radial)' },
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
// Largest bore radius that still leaves 1.2 mm of wall under the knurl valleys
// (valley radius = D/2 - depth). Caps oversized shaft/insert sizes on small knobs.
const MIN_WALL = 1.2;
const maxBoreR = D / 2 - p.depth - MIN_WALL;
if (p.mount === 'insert') {
  // Heat-set threaded insert: a melt-in bore sized from the metric table. The
  // "Shaft dia / insert screw size" param is read as the screw's nominal size
  // and snapped to the nearest of M3/M4/M5/M6/M8 (so 3-12 all map sensibly),
  // then capped so the bore leaves a solid wall inside the knob (maxBoreR).
  const sizes = [3, 4, 5, 6, 8];
  const maxHole = 2 * maxBoreR;
  let nominal = sizes.reduce((best, s) => (Math.abs(s - p.shaftDia) < Math.abs(best - p.shaftDia) ? s : best), sizes[0]);
  while (nominal > sizes[0] && fasteners.fastener('M' + nominal).insert.hole > maxHole) {
    nominal = sizes[sizes.indexOf(nominal) - 1];
  }
  const hole = fasteners.fastener('M' + nominal).insert.hole;
  const bore = Manifold.cylinder(boreDepth, hole / 2, hole / 2, seg).translate([0, 0, -0.1]);
  knob = knob.subtract(bore);
} else {
  // Bore radius = shaft radius + print clearance (FDM holes shrink).
  const r = Math.min(p.shaftDia / 2 + p.clearance, maxBoreR);
  let bore = Manifold.cylinder(boreDepth, r, r, seg).translate([0, 0, -0.1]);
  if (p.mount === 'D-shaft') {
    // Flatten one side of the bore for a D-shaped potentiometer shaft. Standard
    // D-shafts measure 0.75 x diameter from the flat to the opposite round
    // side (4.5 mm on a 6 mm shaft), so the flat sits 0.25 x diameter from the
    // axis (1.5 mm for 6 mm). The knob's flat is that plus the print clearance;
    // the circular segment beyond the chord is removed from the bore.
    const flat = Math.min(0.25 * p.shaftDia + p.clearance, r - 0.3);
    const cut = Manifold.cube([D, r + 1, boreDepth + 1], false).translate([-D / 2, flat, -0.5]);
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
