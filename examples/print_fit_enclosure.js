// Print-Fit joinery demo — a two-part enclosure that actually assembles.
//
// The base gets M3 heat-set insert bosses in two corners; the lid gets matching
// counterbored screw holes plus an alignment pin/socket pair so the halves
// register. Everything is sized from api.printFit's fastener table, so the
// holes fit real M3 hardware. The two parts are laid out side by side.

const { Manifold, printFit } = api;

const W = 50, D = 40, H = 18;     // outer footprint
const wall = 2;
const inset = 6;                  // boss/hole inset from the corners

// Corner anchor positions (relative to each part's local origin at a corner).
const anchors = [
  [inset, inset],
  [W - inset, D - inset],
];

// ---- Base: a tray with insert bosses in two corners --------------------
let base = Manifold.cube([W, D, H], false);
const cavity = Manifold.cube([W - 2 * wall, D - 2 * wall, H], false)
  .translate([wall, wall, wall]);
base = base.subtract(cavity);

for (const [x, y] of anchors) {
  // Sink the boss 0.5mm into the floor so the union fuses solidly (touching
  // coplanar faces don't merge — shapes must volumetrically overlap).
  const boss = printFit.insertBoss({ size: 'M3', height: 8, wall: 2 })
    .translate([x, y, wall - 0.5]);
  base = base.add(boss);
}

// An alignment post in the front-left corner that rises just above the rim and
// registers into the lid. Centered on the wall junction so it fuses to the
// floor and both walls; embedded 0.5mm into the floor so the union is solid.
const postLen = H - wall + 1;
base = base.add(
  printFit.pin({ diameter: 4, length: postLen }).translate([wall, wall, wall - 0.5]),
);

// ---- Lid: a cap with counterbored screw holes + a registration socket --
const lidT = 6;
let lid = Manifold.cube([W, D, lidT], false);

for (const [x, y] of anchors) {
  // Counterbored M3 from the top face (top at z = lidT).
  const hole = printFit.screwHole({ size: 'M3', length: lidT, head: 'socket' })
    .translate([x, y, lidT]);
  lid = lid.subtract(hole);
}

// Socket on the underside, at the matching front-left corner, that the base
// post drops into (snug fit).
lid = lid.subtract(
  printFit.socket({ diameter: 4, depth: 5, fit: 'snug' })
    .translate([wall, wall, lidT]),
);

// Lay the lid beside the base so both print flat.
lid = lid.translate([W + 10, 0, 0]);

return base.add(lid);
