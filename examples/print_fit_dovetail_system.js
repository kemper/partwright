// Dovetail rail system — a horizontal wall-mount rail and a curved coat hook
// that slides on and locks. Print one plate, add as many hooks as you need.
// Rail runs horizontally (X-axis). Hook arm curves down for hanging jackets.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 120, min: 60,  max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'],              label: 'Screw size' },
  hookReach:    { type: 'number', default: 45,  min: 25,  max: 120, step: 5,  unit: 'mm', label: 'Arm reach' },
});

// ── Rail plate ────────────────────────────────────────────────────────────────
// Plate: X = railLen (horizontal), Y = plateT (thickness), Z = plateH (height)
const railLen  = p.railLength;
const railW    = 16;
const plateH   = 40;
const plateT   = 6;
const Cp = 1.5;

// Profile in XY: X = plateH, Y = plateT — chamfered octagon
const plateProfile = new CrossSection([[
  [Cp, 0], [plateH - Cp, 0], [plateH, Cp], [plateH, plateT - Cp],
  [plateH - Cp, plateT], [Cp, plateT], [0, plateT - Cp], [0, Cp],
]]);
// Extrude along Z by railLen, rotate so plate runs along X
let plate = Manifold.extrude(plateProfile, railLen)
  .rotate([0, -90, 0])
  .translate([railLen, 0, 0]);
// Plate: X 0..railLen, Y 0..plateT, Z 0..plateH

// Dovetail tail already runs along X — just translate into position
const { tail } = printFit.dovetail({ length: railLen, width: railW, depth: 6, angle: 14, fit: 'normal' });
plate = plate.add(tail.translate([0, plateT - 0.5, plateH / 2]));

// Screw holes: two Z-columns flanking the rail, rows spaced along X
const endMargin = 15;
const usableLen = railLen - 2 * endMargin;
const levels    = Math.max(1, Math.round(usableLen / p.screwSpacing) + 1);
const colZ      = [plateH * 0.15, plateH * 0.85];
for (let i = 0; i < levels; i++) {
  const x = endMargin + (levels === 1 ? usableLen / 2 : (usableLen * i) / (levels - 1));
  for (const z of colZ) {
    const hole = printFit.screwHole({ size: p.screwSize, length: plateT, head: 'countersunk', through: true })
      .rotate([-90, 0, 0])
      .translate([x, plateT, z]);
    plate = plate.subtract(hole);
  }
}

// ── Wall hook ─────────────────────────────────────────────────────────────────
// Hook block: X = hookBlockW (slides along rail), Y = hookBlockT, Z = hookBlockH
const hookBlockW = 34;
const hookBlockT = 20;   // deep enough to anchor the arm cleanly
const hookBlockH = 40;
const Ch = 1.5;

const blockProfile = new CrossSection([[
  [Ch, 0], [hookBlockW - Ch, 0], [hookBlockW, Ch], [hookBlockW, hookBlockT - Ch],
  [hookBlockW - Ch, hookBlockT], [Ch, hookBlockT], [0, hookBlockT - Ch], [0, Ch],
]]);
let hook = Manifold.extrude(blockProfile, hookBlockH);

// Dovetail socket runs along X — groove centred at hookBlockH/2, 10 mm overhang each side
const { socket } = printFit.dovetail({ length: hookBlockW + 20, width: railW, depth: 6, angle: 14, fit: 'normal' });
hook = hook.subtract(socket.translate([-10, 0, hookBlockH / 2]));

// ── Curved coat hook arm ──────────────────────────────────────────────────────
// Arm path (side/YZ view): exits block front at mid-height (Z=armZCenter), goes
// straight forward (+Y), bends 90° down, then hangs as a tapered tip below the block.
//
// Key invariant: tipBaseY = hookBlockT + stemLen - bendR must be > hookBlockT
// (tip must clear the block face). With stemLen = hookReach and min hookReach=25,
// tipBaseY = hookBlockT + hookReach - bendR = 20 + 25 - 20 = 25 > 20. ✓
const armR       = 10;           // tube radius — substantial 20mm diameter
const bendR      = 20;           // quarter-circle bend radius
const stemLen    = p.hookReach;  // straight forward reach (arm param drives this directly)
const armZCenter = hookBlockH / 2; // arm exits at mid-height; tipBaseZ = armZCenter - bendR = 0
const cx         = hookBlockW / 2;

// Straight stem going in +Y from block front face
const stem = Manifold.cylinder(stemLen, armR, armR, 24)
  .rotate([-90, 0, 0])
  .translate([cx, hookBlockT, armZCenter]);

// Quarter-torus bend: sweeps from +Y direction to -Z direction.
// revolve(profile, n, 90) yields arc in XY: (bendR,0,0)→(0,bendR,0).
// rotate([-90,0,0]).rotate([0,0,90]) reorients into YZ: (0,bendR,0)→(0,0,-bendR).
const bendProfile = CrossSection.circle(armR, 24).translate([bendR, 0]);
const bend = Manifold.revolve(bendProfile, 24, 90)
  .rotate([-90, 0, 0])
  .rotate([0, 0, 90])
  .translate([cx, hookBlockT + stemLen - bendR, armZCenter]);

// Tapered downward tip — hangs below the block
const tipBaseY = hookBlockT + stemLen - bendR;
const tipBaseZ = armZCenter - bendR;  // = 0 (flush with block bottom)
const tipLen   = 30;
const tip = Manifold.cylinder(tipLen, armR, armR * 0.6, 24)
  .rotate([180, 0, 0])
  .translate([cx, tipBaseY, tipBaseZ]);

// Ball cap at tip end
const ball = Manifold.sphere(armR * 0.75, 24)
  .translate([cx, tipBaseY, tipBaseZ - tipLen]);

hook = hook.add(stem).add(bend).add(tip).add(ball);

// ── Layout: plate left, hook right ───────────────────────────────────────────
const plateColored = api.label(plate, 'plate', { color: '#b5764f' });
const hookColored  = api.label(
  hook.translate([railLen + 20, 0, 0]),
  'hook', { color: '#5f8a8c' }
);
return plateColored.add(hookColored);
