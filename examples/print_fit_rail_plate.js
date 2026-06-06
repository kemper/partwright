// Dovetail rail plate — mounts flush to a wall with countersunk screws and
// carries a dovetail rail along its full length. Screws sit in two columns that
// flank the rail (never under it, so a screwdriver always has clearance), and
// the level count auto-scales with rail length. Pair with the Dovetail Wall
// Hook (a separate catalog entry) — print one plate, print as many hooks as you
// need.
//
// Mounted orientation: back face (y=0) against the wall, rail protrudes into
// the room (+Y), rail runs vertically (+Z). Prints flat on its back.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 150, min: 60, max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30, max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'], label: 'Screw size' },
});

const railLen  = p.railLength;
const railW    = 16;   // dovetail nominal width
const plateW   = 44;   // wide enough to flank the rail with screw columns
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
const { tail } = printFit.dovetail({ length: railLen, width: railW, depth: 6, angle: 14, fit: 'normal' });
const rail = tail.rotate([0, -90, 0]).translate([plateW / 2, plateT - 0.5, 0]);
plate = plate.add(rail);

// Countersunk screw holes in two columns flanking the rail, at matched Z levels
// so the plate mounts level. Level count auto-scales with rail length. The rail
// occupies the center, so the columns sit in the clear margins on either side —
// a screwdriver always has room to reach them.
const endMargin = 15;
const usableLen = railLen - 2 * endMargin;
const levels    = Math.max(1, Math.round(usableLen / p.screwSpacing) + 1);
const colX      = [plateW * 0.15, plateW * 0.85];  // ~6.6 and ~37.4 — clear of the rail base
for (let i = 0; i < levels; i++) {
  const z = endMargin + (levels === 1 ? usableLen / 2 : (usableLen * i) / (levels - 1));
  for (const x of colX) {
    // Drill along -Y through the plate. screwHole drills along -Z; rotate
    // [-90,0,0] maps -Z → -Y. Entrance (countersink) on the front face.
    const hole = printFit.screwHole({ size: p.screwSize, length: plateT, head: 'countersunk', through: true })
      .rotate([-90, 0, 0])
      .translate([x, plateT, z]);
    plate = plate.subtract(hole);
  }
}

return api.label(plate, 'plate', { color: '#b5764f' });
