// Lumberjack — figurine holding an axe in the right hand, head up, ready to strike.
// Front = −Y, Z up, figure-left = +X, figure-right = −X.
//
// The axe is built CENTRED at the origin along its local +Z, with the AXE HEAD
// at +Z (business end up) and the handle butt at −Z. Then `F.grasp(axe, rig.grip.R)`
// seats it in the right hand — thumb lands at the head end, fingers wrap the
// haft, the head points along the arm's `holds: 'up'` direction.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — stocky lumberjack, axe arm raised so the head sits high, ready to swing.
const rig = F.rig({
  height: 64, headsTall: 6.0, build: 'stocky', sex: 'male', muscle: 0.55,
  pose: {
    // Right (axe) arm: forearm forward + `holds: 'up'` ⇒ axe head points UP.
    // A small raiseSide opens the arm clear of the torso; bend 90 brings the
    // forearm horizontal so the axe rises vertically beside the head.
    armR: { raiseSide: 8, raiseFwd: 0, bend: 90, holds: 'up' },
    // Left arm relaxed at the side, slight forward swing.
    armL: { raiseSide: 12, raiseFwd: 6, bend: 18 },
    // Braced stance.
    legL: { raiseSide: 9 }, legR: { raiseSide: 9, bend: 4 },
    head: { yaw: -4, pitch: -2 },
    spine: { turn: 2 },
  },
});
const j = rig.joints, r = rig.r, H = rig.opts.height;

// 2. HEAD + FACE — a bearded lumberjack: nose, neutral mouth, ears, brows.
const head = F.head(rig, { jaw: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.10, width: r.head * 0.22 },
  mouth: { style: 'lips', width: r.head * 0.28 },
  ears: { size: r.head * 0.20 },
  brows: { thickness: r.head * 0.05 },
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.13, lids: 'upper' });

// 3. SKIN — right hand a clutched fist around the axe haft.
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig),
  F.hands(rig, { grip: 'clutch' }),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. BEARD — a chunky beard hard-unioned (paints separately from skin).
const chinPt = rig.face.chinTip;
const beard = sdf.ellipsoid(r.head * 0.55, r.head * 0.42, r.head * 0.55)
  .translate([chinPt[0], chinPt[1] + r.head * 0.05, chinPt[2] + r.head * 0.05])
  .smoothIntersect(
    sdf.box([r.head * 2, r.head * 2, r.head * 1.2])
      .translate([0, chinPt[1], chinPt[2] - r.head * 0.3]),
    r.head * 0.15,
  )
  .label('beard');

// 5. CLOTHING — flannel shirt + work pants (garment parts).
const shirtThick = r.chestX * 0.10;
const shirtG = F.garment.top(rig, { sleeve: 'long', thickness: shirtThick });
const shirt = shirtG.all.label('shirt');
const pantsG = F.garment.pants(rig, { leg: 'slim', rise: 'mid' });
const pants = pantsG.all.label('pants');

// 6. BOOTS — work boots track the sole frames.
const boots = F.clothing.boots(rig).label('boots');

// 7. BELT — thin band conformed to the torso panel + hips (NOT the sleeves).
const beltClear = shirtThick + r.chestX * 0.02;
const beltCore = sdf.union(shirtG.torso, pantsG.hips);
const beltBand = F.band(rig.ring.waist, {
  surface: beltCore,
  thickness: r.waist * 0.10,
  height: r.chestX * 0.45,
  clearance: beltClear,
  clear: F.arms(rig),
});
const bucklePt = F.ringPoint(rig.ring.waist, 0, { surface: beltCore, clearance: beltClear });
const buckle = sdf.roundedBox([r.waist * 0.42, r.waist * 0.25, r.chestX * 0.42], r.waist * 0.05)
  .translate(bucklePt);
const belt = beltBand.union(buckle).label('belt');

// 8. AXE — built along +Z centred at origin, axe HEAD at +Z, butt at −Z.
//
// Local-frame mapping after F.grasp on the right hand with `holds: 'up'`:
//   prop local +Z  →  world +Z  (up — the haft is vertical, head at top)
//   prop local +Y  →  palmNormal = world +X  (figure-LEFT, across the body)
//   prop local +X  →  world -Y   (FORWARD — toward the camera)
// So the BLADE FLARE must be built along local +X (or -X for back) so that
// after grasp it points forward into the work, not sideways across the body.
const haftLen = H * 0.55;
const haftR = r.hand * 0.28;
const headZ = haftLen * 0.5;             // axe head sits at the +Z end of the haft
const headHeight = r.hand * 3.2;         // tall blade (top-to-bottom along haft axis)
const headThick = r.hand * 0.45;         // thin in the perp-to-swing axis (local Y)
const bladeReach = r.hand * 2.6;         // how far the blade flares forward (local +X)
const pollReach = r.hand * 0.55;         // small back-spike (local -X)

// Haft: vertical capsule centred at origin, +Z end is where the head clamps.
const haft = sdf.capsule([0, 0, -haftLen * 0.5], [0, 0, haftLen * 0.5], haftR);

// A small knob/pommel on the bottom of the haft (butt end) for grip security.
const buttKnob = sdf.sphere(haftR * 1.4).translate([0, 0, -haftLen * 0.5]);

// Blade: flared sheet in the X-Z plane (swing plane), thin in local Y.
const bladeBlob = sdf.ellipsoid(bladeReach, headThick * 0.55, headHeight * 0.5)
  // Shift along +X so the blade flares OUT past the haft (back edge against haft).
  .translate([bladeReach * 0.55, 0, headZ]);

// Eye block: wraps the haft, X-aligned so it reads as a wide head.
const eye = sdf.roundedBox(
  [r.hand * 1.0, headThick * 2.0, headHeight * 0.55],
  r.hand * 0.08,
).translate([0, 0, headZ]);

// Poll: small back-spike along local -X.
const poll = sdf.roundedBox(
  [pollReach * 2, headThick * 1.4, headHeight * 0.35],
  r.hand * 0.08,
).translate([-pollReach * 0.6, 0, headZ]);

// Combine: eye holds the haft; blade flares forward; poll juts back.
const axeHead = eye.smoothUnion(bladeBlob, r.hand * 0.25).smoothUnion(poll, r.hand * 0.18);

// Full axe = haft + butt + head, all centred & axis-aligned, head at +Z.
const axeLocal = haft.smoothUnion(buttKnob, haftR * 0.4).smoothUnion(axeHead, r.hand * 0.25);

// Seat the axe in the right fist. F.grasp puts the bar IN the finger cup
// (not at the wrist) and auto-orients so the thumb lands at the +Z (head) end.
const axe = F.grasp(axeLocal, rig.grip.R).label('axe');

// 9. HAIR — short, beneath a knit cap would be ideal, but keep simple here.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 10. BASE
const base = F.base(rig, { radius: H * 0.28 }).label('base');

// 11. COLOR — in-code paint so the figure bakes self-coloured.
api.paint.label('skin', '#d6a578');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#3a5a3a');
api.paint.label('pupil', '#161616');
api.paint.label('lids', '#d6a578');
api.paint.label('hair', '#5a3520');
api.paint.label('beard', '#5a3520');
api.paint.label('shirt', '#a8221d');      // classic red flannel
api.paint.label('pants', '#3a2a1a');      // dark canvas
api.paint.label('boots', '#3a1a0a');      // brown work boots
api.paint.label('belt', '#2a1a0e');
api.paint.label('axe', '#a8a8a8');        // steel head (haft also painted axe for now)
api.paint.label('base', '#4a4036');

// 12. COMPOSITE
const body = sdf.union(skin, shirt, pants, boots, belt);
return sdf.union(body, eyes, beard, axe, hair, base)
  .build({ edgeLength: 0.45, detail: [...F.faceDetail(rig)] });
