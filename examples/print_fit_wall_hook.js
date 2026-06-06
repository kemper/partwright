// Dovetail wall hook — slides down onto a dovetail rail plate. The dovetail
// groove on the back locks against pulling forward; lift to remove. A rounded
// J-hook out front cradles cables, headphones, keys, or tools.
//
// Designed to pair with the Dovetail Rail Plate — print one plate, print as
// many hooks as needed. Adjust reach and lip height in the Customizer.
const { Manifold, CrossSection, printFit } = api;

const p = api.params({
  hookReach: { type: 'number', default: 34, min: 15, max: 80, step: 2, unit: 'mm', label: 'Hook reach' },
  lipHeight: { type: 'number', default: 22, min: 10, max: 50, step: 2, unit: 'mm', label: 'Lip height' },
});

const hookBlockW = 38;
const hookBlockT = 14;
const hookBlockH = 30;
const chamfer    = 1.5;
const armW       = 16;
const armThk     = 10;
const roundR     = 3;    // arm cross-section corner radius
const innerR     = 4;    // inner J-corner fillet radius

// ---- Hook block with chamfered edges ----
const C = chamfer;
const blockProfile = new CrossSection([[
  [C, 0], [hookBlockW - C, 0], [hookBlockW, C], [hookBlockW, hookBlockT - C],
  [hookBlockW - C, hookBlockT], [C, hookBlockT], [0, hookBlockT - C], [0, C],
]]);
let hook = Manifold.extrude(blockProfile, hookBlockH);

// Dovetail groove on the back face (y=0), centered in X, slides along +Z.
// Use length >> hookBlockH so the groove runs through the full block — the hook
// slides freely along the rail in both directions.
const { socket } = printFit.dovetail({ length: hookBlockH + 20, width: 16, depth: 6, angle: 14, fit: 'normal' });
const groove = socket.rotate([0, -90, 0]).translate([hookBlockW / 2, 0, -10]);
hook = hook.subtract(groove);

// ---- Rounded-rectangle arm reaching +Y ----
// Profile in XY: armW × armThk with rounded corners; extruded along Z then
// rotated so it goes along +Y.
const armProfile = CrossSection.square([armW, armThk])
  .offset(-roundR)
  .offset(roundR, 'round');
const armReach = p.hookReach;
const armX  = hookBlockW / 2 - armW / 2;
const armZ  = 4;   // arm sits at z=armZ..armZ+armThk
const arm   = Manifold.extrude(armProfile, armReach)
  .rotate([-90, 0, 0])
  .translate([armX, hookBlockT - 0.5, armZ + armThk]);
hook = hook.add(arm);

// ---- Upturned lip (same rounded profile) ----
const lipH = p.lipHeight;
const lip  = Manifold.extrude(armProfile, lipH)
  .translate([armX, hookBlockT - 0.5 + armReach - armThk, armZ]);
hook = hook.add(lip);

// ---- Chamfer the inner J corner ----
// A 45°-rotated cube cuts a smooth bevel at the concave corner where the arm
// meets the lip. The cube center sits at the corner point; rotation creates
// a diagonal cut face rather than a sharp 90° edge.
const lip_inner_y = hookBlockT - 0.5 + armReach - armThk;
const arm_top_z   = armZ + armThk;
const c           = innerR * Math.SQRT2;
const cornerCut   = Manifold.cube([armW + 2, c, c], false)
  .translate([armX - 0.01, -c / 2, -c / 2])
  .rotate([45, 0, 0])
  .translate([0, lip_inner_y, arm_top_z]);
hook = hook.subtract(cornerCut);

return api.label(hook, 'hook', { color: '#5f8a8c' });
