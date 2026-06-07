// Dovetail rail system — a horizontal wall-mount rail and a peg-style coat hook
// that slides on and locks. Rail runs horizontally (X-axis).
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 120, min: 60,  max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'],              label: 'Screw size' },
  hookReach:    { type: 'number', default: 40,  min: 20,  max: 100, step: 5,  unit: 'mm', label: 'Peg length' },
});

// ── Rail plate ────────────────────────────────────────────────────────────────
const railLen  = p.railLength;
const railW    = 16;
const plateH   = 40;
const plateT   = 6;
const Cp = 1.5;

const plateProfile = new CrossSection([[
  [Cp, 0], [plateH - Cp, 0], [plateH, Cp], [plateH, plateT - Cp],
  [plateH - Cp, plateT], [Cp, plateT], [0, plateT - Cp], [0, Cp],
]]);
let plate = Manifold.extrude(plateProfile, railLen)
  .rotate([0, -90, 0])
  .translate([railLen, 0, 0]);

const { tail } = printFit.dovetail({ length: railLen, width: railW, depth: 6, angle: 14, fit: 'normal' });
plate = plate.add(tail.translate([0, plateT - 0.5, plateH / 2]));

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
const hookBlockW = 34;
const hookBlockT = 20;
const hookBlockH = 40;
const Ch = 1.5;

const blockProfile = new CrossSection([[
  [Ch, 0], [hookBlockW - Ch, 0], [hookBlockW, Ch], [hookBlockW, hookBlockT - Ch],
  [hookBlockW - Ch, hookBlockT], [Ch, hookBlockT], [0, hookBlockT - Ch], [0, Ch],
]]);
let hook = Manifold.extrude(blockProfile, hookBlockH);

const { socket } = printFit.dovetail({ length: hookBlockW + 20, width: railW, depth: 6, angle: 14, fit: 'normal' });
hook = hook.subtract(socket.translate([-10, 0, hookBlockH / 2]));

// ── Peg-style coat hook arm ───────────────────────────────────────────────────
// Shape (side view / YZ plane): vertical stem rises above block top, quarter-circle
// bends it forward (+Y), tapered arm extends horizontally, ball cap at tip.
// This reads clearly from the FRONT view (XZ): stem column + arc cap + ball silhouette.
// It reads clearly from the SIDE view (YZ): full peg-hook profile.
const armR   = 8;
const bendR  = 14;
const stemH  = 14;           // vertical section above block top
const armLen = p.hookReach;  // forward horizontal section
const cy     = hookBlockT / 2;  // arm centred in block depth
const cx     = hookBlockW / 2;

// Vertical stem above block
const stem = Manifold.cylinder(stemH, armR, armR, 24)
  .translate([cx, cy, hookBlockH]);

// Quarter-torus: bends from +Z direction to +Y direction.
// Default revolve arc (XY, CCW around Z): (bendR,0,0)→(0,bendR,0).
//   Tangent at start (0°): +Y.  Tangent at end (90°): −X.
// After rotate([90,0,0]) then rotate([0,0,-90]):
//   Tangent at start becomes +Z (matches stem going up).
//   Tangent at end becomes +Y (matches arm going forward).
// Arc local start at (0,−bendR,0) → translate to stem top: add (cx, cy+bendR, hookBlockH+stemH).
const bendProfile = CrossSection.circle(armR, 24).translate([bendR, 0]);
const bend = Manifold.revolve(bendProfile, 24, 90)
  .rotate([90, 0, 0])
  .rotate([0, 0, -90])
  .translate([cx, cy + bendR, hookBlockH + stemH]);

// Tapered horizontal arm in +Y
const arm = Manifold.cylinder(armLen, armR, armR * 0.6, 24)
  .rotate([-90, 0, 0])
  .translate([cx, cy + bendR, hookBlockH + stemH + bendR]);

// Ball cap
const ball = Manifold.sphere(armR * 1.3, 24)
  .translate([cx, cy + bendR + armLen, hookBlockH + stemH + bendR]);

hook = hook.add(stem).add(bend).add(arm).add(ball);

// ── Layout: plate left, hook right ───────────────────────────────────────────
const plateColored = api.label(plate, 'plate', { color: '#b5764f' });
const hookColored  = api.label(
  hook.translate([railLen + 20, 0, 0]),
  'hook', { color: '#5f8a8c' }
);
return plateColored.add(hookColored);
