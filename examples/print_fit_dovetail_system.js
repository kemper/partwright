// Dovetail rail system — a horizontal wall-mount rail and a curved coat hook
// that slides on and locks. Print one plate, add as many hooks as you need.
// Rail runs horizontally (X-axis). Hook arm curves down for hanging jackets.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 120, min: 60,  max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'],              label: 'Screw size' },
  hookReach:    { type: 'number', default: 34,  min: 15,  max: 80,  step: 2,  unit: 'mm', label: 'Hook reach' },
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
const hookBlockW = 38;
const hookBlockT = 14;
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
const armR       = 7;                         // tube radius (mm)
const bendR      = 18;                        // bend centre-arc radius (mm)
const stemLen    = Math.max(5, p.hookReach - bendR);
const armZCenter = hookBlockH * 0.75;         // arm exits at 75 % of block height
const cx         = hookBlockW / 2;            // centred in X on block

// Straight stem going in +Y from block front face
const stem = Manifold.cylinder(stemLen, armR, armR, 24)
  .rotate([-90, 0, 0])
  .translate([cx, hookBlockT, armZCenter]);

// Quarter-torus: sweeps from +Y direction to -Z direction.
// revolve(profile, n, 90) yields a quarter-torus arc in XY: (bendR,0,0)→(0,bendR,0).
// Two rotations reorient it into YZ: (0,bendR,0)→(0,0,-bendR) — arm curves down.
const bendProfile = CrossSection.circle(armR, 24).translate([bendR, 0]);
const bend = Manifold.revolve(bendProfile, 24, 90)
  .rotate([-90, 0, 0])
  .rotate([0, 0, 90])
  .translate([cx, hookBlockT + stemLen - bendR, armZCenter]);

// Downward tapered tip
const tipBaseY = hookBlockT + stemLen - bendR;
const tipBaseZ = armZCenter - bendR;
const tipLen   = 22;
const tip = Manifold.cylinder(tipLen, armR, armR * 0.55, 24)
  .rotate([180, 0, 0])
  .translate([cx, tipBaseY, tipBaseZ]);

// Ball cap
const ball = Manifold.sphere(armR * 0.7, 24)
  .translate([cx, tipBaseY, tipBaseZ - tipLen]);

hook = hook.add(stem).add(bend).add(tip).add(ball);

// ── Layout: plate left, hook right ───────────────────────────────────────────
const plateColored = api.label(plate, 'plate', { color: '#b5764f' });
const hookColored  = api.label(
  hook.translate([railLen + 20, 0, 0]),
  'hook', { color: '#5f8a8c' }
);
return plateColored.add(hookColored);
