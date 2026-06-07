// Electronics project box — a parametric base tray with M3 heat-set insert
// bosses in the four corners and a matching lid with countersunk screw holes.
// Drop brass inserts into the bosses with a soldering iron, then screw the lid
// down with flat-head screws that sit flush. Vent slots on the long walls keep
// electronics cool. Adjust all dimensions in the Customizer.
const { Manifold, printFit } = api;

const p = api.params({
  width:     { type: 'number', default: 60, min: 40, max: 120, step: 2, unit: 'mm', label: 'Width' },
  depth:     { type: 'number', default: 44, min: 30, max: 100, step: 2, unit: 'mm', label: 'Depth' },
  height:    { type: 'number', default: 24, min: 15, max: 60,  step: 1, unit: 'mm', label: 'Height' },
  wall:      { type: 'number', default: 2.4, min: 1.5, max: 4, step: 0.2, unit: 'mm', label: 'Wall thickness' },
  screwSize: { type: 'select', default: 'M3', options: ['M2.5', 'M3', 'M4'], label: 'Screw size' },
  ventCount: { type: 'int',    default: 4, min: 0, max: 10, label: 'Vents per long side' },
});

const { width: W, depth: D, height: H, wall, screwSize, ventCount } = p;
const inset = 7;
const lidT = 3;

const corners = [
  [inset,     inset],
  [W - inset, inset],
  [inset,     D - inset],
  [W - inset, D - inset],
];

// ---- Base: open-top tray ----
let base = Manifold.cube([W, D, H], false);
const cavity = Manifold.cube([W - 2 * wall, D - 2 * wall, H], false)
  .translate([wall, wall, wall]);
base = base.subtract(cavity);

// Insert bosses sunk 0.5 mm into the floor so the union fuses solidly.
for (const [x, y] of corners) {
  const boss = printFit.insertBoss({ size: screwSize, height: H - wall + 0.5, wall: 2.2 })
    .translate([x, y, wall - 0.5]);
  base = base.add(boss);
}

// Vent slots on the two long (Y-axis) walls, centered vertically.
if (ventCount > 0) {
  const ventW = 2.0;
  const ventH = Math.min(10, H - wall * 3);
  const LIP = 0.1;
  const usableX = W - 2 * wall;
  const spacing = usableX / ventCount;
  for (let i = 0; i < ventCount; i++) {
    const cx = wall + spacing * (i + 0.5);
    const slotFront = Manifold.cube([ventW, wall + 2 * LIP, ventH])
      .translate([cx - ventW / 2, -LIP, H / 2 - ventH / 2]);
    const slotBack = Manifold.cube([ventW, wall + 2 * LIP, ventH])
      .translate([cx - ventW / 2, D - wall - LIP, H / 2 - ventH / 2]);
    base = base.subtract(slotFront).subtract(slotBack);
  }
}

// ---- Lid: flat cap with countersunk screw holes ----
let lid = Manifold.cube([W, D, lidT], false);
for (const [x, y] of corners) {
  const hole = printFit.screwHole({ size: screwSize, length: lidT, head: 'countersunk', through: true })
    .translate([x, y, lidT]);
  lid = lid.subtract(hole);
}

const baseColored = api.label(base, 'base', { color: '#4f7da6' });
const lidColored  = api.label(lid.translate([W + 10, 0, 0]), 'lid', { color: '#c2ad7e' });
return baseColored.add(lidColored);
