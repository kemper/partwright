// Dovetail rail system — a wall-mount plate that carries a dovetail rail and
// matching hooks that slide on and lock. Print one plate, then print as many
// hooks as you need. Adjust all dimensions in the Customizer.
//
// Mounted orientation: back face (y=0) against the wall, rail protrudes into
// the room (+Y), rail runs vertically (+Z). Both parts print flat on their backs.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  railLength:   { type: 'number', default: 120, min: 60,  max: 400, step: 10, unit: 'mm', label: 'Rail length' },
  screwSpacing: { type: 'number', default: 50,  min: 30,  max: 120, step: 5,  unit: 'mm', label: 'Screw spacing' },
  screwSize:    { type: 'select', default: 'M4', options: ['M3', 'M4', 'M5'],              label: 'Screw size' },
  hookReach:    { type: 'number', default: 34,  min: 15,  max: 80,  step: 2,  unit: 'mm', label: 'Hook reach' },
  lipHeight:    { type: 'number', default: 22,  min: 10,  max: 50,  step: 2,  unit: 'mm', label: 'Lip height' },
});

// ── Rail plate ────────────────────────────────────────────────────────────────
const railLen  = p.railLength;
const railW    = 16;
const plateW   = 44;
const plateT   = 6;
const chamfer  = 1.5;

const Cp = chamfer;
const plateProfile = new CrossSection([[
  [Cp, 0], [plateW - Cp, 0], [plateW, Cp], [plateW, plateT - Cp],
  [plateW - Cp, plateT], [Cp, plateT], [0, plateT - Cp], [0, Cp],
]]);
let plate = Manifold.extrude(plateProfile, railLen);

const { tail } = printFit.dovetail({ length: railLen, width: railW, depth: 6, angle: 14, fit: 'normal' });
const rail = tail.rotate([0, -90, 0]).translate([plateW / 2, plateT - 0.5, 0]);
plate = plate.add(rail);

const endMargin = 15;
const usableLen = railLen - 2 * endMargin;
const levels    = Math.max(1, Math.round(usableLen / p.screwSpacing) + 1);
const colX      = [plateW * 0.15, plateW * 0.85];
for (let i = 0; i < levels; i++) {
  const z = endMargin + (levels === 1 ? usableLen / 2 : (usableLen * i) / (levels - 1));
  for (const x of colX) {
    const hole = printFit.screwHole({ size: p.screwSize, length: plateT, head: 'countersunk', through: true })
      .rotate([-90, 0, 0])
      .translate([x, plateT, z]);
    plate = plate.subtract(hole);
  }
}

// ── Wall hook ─────────────────────────────────────────────────────────────────
const hookBlockW = 38;
const hookBlockT = 14;
const hookBlockH = 30;
const armW       = 16;
const armThk     = 10;
const roundR     = 3;
const innerR     = 4;
const Ch         = 1.5;

const blockProfile = new CrossSection([[
  [Ch, 0], [hookBlockW - Ch, 0], [hookBlockW, Ch], [hookBlockW, hookBlockT - Ch],
  [hookBlockW - Ch, hookBlockT], [Ch, hookBlockT], [0, hookBlockT - Ch], [0, Ch],
]]);
let hook = Manifold.extrude(blockProfile, hookBlockH);

const { socket } = printFit.dovetail({ length: hookBlockH + 20, width: 16, depth: 6, angle: 14, fit: 'normal' });
const groove = socket.rotate([0, -90, 0]).translate([hookBlockW / 2, 0, -10]);
hook = hook.subtract(groove);

const armProfile = CrossSection.square([armW, armThk])
  .offset(-roundR)
  .offset(roundR, 'round');
const armReach = p.hookReach;
const armX     = hookBlockW / 2 - armW / 2;
const armZ     = 4;
const arm      = Manifold.extrude(armProfile, armReach)
  .rotate([-90, 0, 0])
  .translate([armX, hookBlockT - 0.5, armZ + armThk]);
hook = hook.add(arm);

const lipH = p.lipHeight;
const lip  = Manifold.extrude(armProfile, lipH)
  .translate([armX, hookBlockT - 0.5 + armReach - armThk, armZ]);
hook = hook.add(lip);

const lip_inner_y = hookBlockT - 0.5 + armReach - armThk;
const arm_top_z   = armZ + armThk;
const c           = innerR * Math.SQRT2;
const cornerCut   = Manifold.cube([armW + 2, c, c], false)
  .translate([armX - 0.01, -c / 2, -c / 2])
  .rotate([45, 0, 0])
  .translate([0, lip_inner_y, arm_top_z]);
hook = hook.subtract(cornerCut);

// ── Layout: plate on the left, hook on the right ──────────────────────────────
const plateColored = api.label(plate, 'plate', { color: '#b5764f' });
// Position hook beside the plate, centered on the plate's Z midpoint so the
// thumbnail shows both parts at comparable scale.
const hookColored  = api.label(
  hook.translate([plateW + 20, 0, railLen / 2 - hookBlockH / 2]),
  'hook', { color: '#5f8a8c' }
);
return plateColored.add(hookColored);
