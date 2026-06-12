// Battle mage — a hooded adult figure presenting a long quarterstaff held in
// one hand, the staff following the grip so it can't read crooked.
// Front = −Y, Z up, figure's left = +X, right = −X. ~6 heads tall.
//
// SHOWCASE: F.holdAt — the single-hand prop helper. The staff is built centred
// at the origin along its local +Z, then `F.holdAt(staff, rig.grip.R)` aligns
// that axis to the right hand's gripAxis and drops the staff's centre on the
// grip cup, so it lies IN the curled fingers at the hand's natural angle. No
// hand-rolled vector math, no prop impaling the palm. (For a two-handed prop
// use F.spanGrips instead — see figure_rocker.js.)
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — grounded stance; right arm carries the staff out to the side, left
// arm relaxed. Adult hero proportions.
const rig = F.rig({
  height: 64,
  headsTall: 6,
  build: 'average',
  pose: {
    // Right arm: elevated ~55 ° to the side, elbow bent 90 ° so the forearm
    // hangs down; twist 0 gives gripAxis mostly up (+Z≈0.81), so the staff
    // stands diagonally beside the mage with the orb end rising above the hand.
    armR: { abduct: 48, flex: 14, elbow: 78, twist: 0 },
    // Left arm: relaxed at the side.
    armL: { abduct: 12, flex: 8, elbow: 14 },
    legL: { abduct: 9 },
    legR: { abduct: 9 },
    head: { turn: -6, tilt: 2, nod: -2 },
    spine: { lean: -2 },
  },
});
const r = rig.r;

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.09 },
  mouth: { style: 'lips', width: r.head * 0.30 },
  ears: { size: r.head * 0.22 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14 });

// 3. SKIN — relaxed grip so the staff seats in the open finger cup.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. ROBE — long sleeved mage robe.
const robe = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.opts.height * 0.10,
  thickness: r.chestX * 0.14,
}).label('robe');

// 5. HAIR
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 6. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 7. STAFF — built centred at the origin along local +Z, then HELD.
// The quarterstaff is 1.1× figure height; the orb caps the +Z (top) end.
// A slightly thicker rod (0.28× hand) reads clearly at normal scale.
const staffLen = rig.opts.height * 1.15;
const staffR   = r.hand * 0.50;
const orbR     = r.head * 0.48;

// The arm is raised; grip is near the lower third of the staff.
// Local origin is the grip centre: 15 % of the rod hangs below the fist
// (a short trailing stub), 85 % rises above with the orb end up.
// This keeps the lower stub clear of the robe/torso.
const rodBot = [0, 0, -staffLen * 0.15];
const rodTop = [0, 0,  staffLen * 0.85];
const rod = sdf.capsule(rodBot, rodTop, staffR);
const orb = sdf.sphere(orbR).translate([0, 0, staffLen * 0.85]);
const staffLocal = rod.smoothUnion(orb, orbR * 0.45);

// Seat + orient into the right grip. The staff's +Z lands on rig.grip.R.gripAxis
// and its centre on rig.grip.R.point — IN the curled fingers, at the hand angle.
const held = F.holdAt(staffLocal, rig.grip.R);

// Weld a short bridge from the hand centre to the grip cup so the staff and the
// fist fuse into one printable piece even if the cup sits just off the palm.
const bridge = sdf.capsule(rig.joints.handR, rig.grip.R.point, r.hand * 0.5);
const staff = held.smoothUnion(bridge, r.hand * 0.4).label('staff');

// 8. Union + build.
return sdf.union(skin, eyes, robe, hair, staff, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
