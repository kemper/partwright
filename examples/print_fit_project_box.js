// Electronics project box — a base tray with M3 heat-set insert bosses in the
// four corners and a lid with matching M3 countersunk screw holes. Drop brass
// inserts into the bosses with a soldering iron, then screw the lid down with
// flat-head M3 screws that sit flush. The two parts print flat, side by side.
const { Manifold, printFit } = api;

const W = 60, D = 44, H = 24;   // outer base footprint
const wall = 2.4;               // wall + floor thickness
const lidT = 3;                 // lid thickness
const inset = 7;                // boss / hole inset from the corners

const corners = [
  [inset, inset],
  [W - inset, inset],
  [inset, D - inset],
  [W - inset, D - inset],
];

// ---- Base: an open-top tray ----
let base = Manifold.cube([W, D, H], false);
const cavity = Manifold.cube([W - 2 * wall, D - 2 * wall, H], false)
  .translate([wall, wall, wall]);
base = base.subtract(cavity);

// Insert bosses rise from the floor to the rim in each corner, so a screw
// through the lid threads straight into the brass insert. Sink 0.5 mm into the
// floor so the union fuses solidly (coplanar faces don't merge).
for (const [x, y] of corners) {
  const boss = printFit.insertBoss({ size: 'M3', height: H - wall + 0.5, wall: 2.2 })
    .translate([x, y, wall - 0.5]);
  base = base.add(boss);
}

// ---- Lid: a flat cap with countersunk screw holes ----
let lid = Manifold.cube([W, D, lidT], false);
for (const [x, y] of corners) {
  // Countersunk M3 from the top face (top at z = lidT) so the screw sits flush.
  const hole = printFit.screwHole({ size: 'M3', length: lidT, head: 'countersunk', through: true })
    .translate([x, y, lidT]);
  lid = lid.subtract(hole);
}

// Two gentle colors, baked into the model via api.label.
const baseColored = api.label(base, 'base', { color: '#4f7da6' });          // soft blue
const lidColored = api.label(lid.translate([W + 10, 0, 0]), 'lid', { color: '#c2ad7e' }); // soft sand

return baseColored.add(lidColored);
