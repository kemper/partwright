// Dovetail rail plate — mounts flush to a wall with countersunk screws and
// carries a dovetail rail along its full length. The screw count auto-scales
// with rail length. Pair with the Dovetail Wall Hook (a separate catalog entry)
// — print one plate, print as many hooks as you need.
//
// Mounted orientation: back face (y=0) against the wall, rail protrudes into
// the room (+Y), rail runs vertically (+Z). Prints flat on its back.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 150, min: 60, max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 40,  min: 25, max: 100, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'], label: 'Screw size' },
});

const railLen  = p.railLength;
const plateW   = 38;
const plateT   = 6;
const chamfer  = 1.5;

// Chamfered plate profile in XY, extruded to railLen along Z.
const C = chamfer;
const plateProfile = new CrossSection([[
  [C, 0], [plateW - C, 0], [plateW, C], [plateW, plateT - C],
  [plateW - C, plateT], [C, plateT], [0, plateT - C], [0, C],
]]);
let plate = Manifold.extrude(plateProfile, railLen);

// Dovetail rail on the front face (y=plateT), centered in X, runs full length.
// tail slides along +X; rotate so it runs along +Z (vertical).
const { tail } = printFit.dovetail({ length: railLen, width: 16, depth: 6, angle: 14, fit: 'normal' });
const rail = tail.rotate([0, -90, 0]).translate([plateW / 2, plateT - 0.5, 0]);
plate = plate.add(rail);

// Countersunk screw holes, evenly spaced, set back from both ends.
const endMargin = 15;
const usableLen = railLen - 2 * endMargin;
const screwCount = Math.max(1, Math.round(usableLen / p.screwSpacing) + 1);
for (let i = 0; i < screwCount; i++) {
  const z = endMargin + (screwCount === 1 ? 0 : (usableLen * i) / (screwCount - 1));
  // Drill along -Y through the plate. screwHole drills along -Z; rotate [-90,0,0]
  // maps -Z → -Y. Entrance (countersink) on the front face (y=plateT).
  const hole = printFit.screwHole({ size: p.screwSize, length: plateT, head: 'countersunk', through: true })
    .rotate([-90, 0, 0])
    .translate([plateW / 2, plateT, z]);
  plate = plate.subtract(hole);
}

return api.label(plate, 'plate', { color: '#b5764f' });
