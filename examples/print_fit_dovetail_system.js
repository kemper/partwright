// Dovetail rail system — a horizontal wall-mount rail and a curved coat hook
// that slides on and locks. Rail runs horizontally (X-axis).
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 120, min: 60,  max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'],              label: 'Screw size' },
  hookHeight:   { type: 'number', default: 52,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Hook height' },
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

// ── Coat hook arm ────────────────────────────────────────────────────────────
// Shape (side view / YZ plane): short stub exits front face (+Y), tight quarter-circle
// curves it upward (+Z), tapered arm rises vertically.
// Arm is centred on both the width and height of the hook block.
const armR    = 8;
const bendR   = 10;
const stubLen = 6;              // horizontal stub before bend
const vertLen = p.hookHeight;   // vertical section above bend
const cx      = hookBlockW / 2;
const cy      = hookBlockT;     // front face
const exitZ   = hookBlockH / 2; // centred on block height

// Horizontal stub exits front face in +Y
const stub = Manifold.cylinder(stubLen, armR, armR, 24)
  .rotate([-90, 0, 0])
  .translate([cx, cy, exitZ]);

// Quarter-torus: rotate([0,90,0]) maps the XY revolve arc so that
// start tangent stays +Y (matching stub) and end tangent becomes +Z (upward).
const bendProfile = CrossSection.circle(armR, 24).translate([bendR, 0]);
const bend = Manifold.revolve(bendProfile, 24, 90)
  .rotate([0, 90, 0])
  .translate([cx, cy + stubLen, exitZ + bendR]);

// Tapered vertical arm in +Z
const arcEndY = cy + stubLen + bendR;
const arcEndZ = exitZ + bendR;
const vert = Manifold.cylinder(vertLen, armR, armR * 0.55, 24)
  .translate([cx, arcEndY, arcEndZ]);

hook = hook.add(stub).add(bend).add(vert);

// ── Layout: plate left, hook right ───────────────────────────────────────────
const plateColored = api.label(plate, 'plate', { color: '#b5764f' });
const hookColored  = api.label(
  hook.translate([railLen + 20, 0, 0]),
  'hook', { color: '#5f8a8c' }
);
return plateColored.add(hookColored);
