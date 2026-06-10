// Chibi wizard figurine — adorable extreme-chibi proportions (3 heads tall),
// long robe, pointed wizard hat, glowing orb staff, long beard.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — extreme chibi: 3 heads tall = enormous head, short squat body.
// Left arm (figure's left = +X) holds the staff.
// Right arm raised in spell-casting gesture.
const rig = F.rig({
  height: 60,
  headsTall: 3,
  build: 'average',
  pose: {
    // Left arm: pointing slightly forward-down to grip staff
    armL: { abduct: 10, flex: 8, elbow: 15 },
    // Right arm raised — spell-casting
    armR: { abduct: 80, flex: 35, elbow: 50 },
    legL: { abduct: 8 },
    legR: { abduct: 8 },
    head: { turn: 8, tilt: -3, nod: 2 },
    spine: { lean: -2 },
  },
});

// 2. HEAD + FACE
// eyes: false — lifted to top-level labelled region so they can be painted separately.
// mouth: 'smile' style with slight smirk — the carved groove sits above the beard top blob.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.08 },
  mouth: { style: 'smile', smirk: 0.25, width: rig.r.head * 0.42 },
  ears: { size: rig.r.head * 0.25 },
  brows: {},
});

// 3. SKIN
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 3b. EYES — paintable separate region (hard-unioned at top level)
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.20 }); // iris style: labels eyes/iris/pupil itself

// 4. ROBE
const robe = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.opts.height * 0.06,
  thickness: rig.r.chestX * 0.13,
}).label('robe');

// 5. HAIR
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 6. BASE
const base = F.base(rig, {
  radius: rig.opts.height * 0.30,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. WIZARD HAT — pointed cone with wide brim placed at crown
const crown = rig.joints.crown;
const headR = rig.r.head;

const brimR = headR * 1.70;
const brimH = rig.opts.height * 0.052;
const brimZ = crown[2] - headR * 0.22;

const hatBrim = sdf.roundedCylinder(brimR, brimH, brimH * 0.40)
  .translate([crown[0], crown[1], brimZ]);

const hatH = rig.opts.height * 0.62;
const hatBaseR = headR * 0.80;
const hatBaseZ = brimZ + brimH * 0.30;

const hatConeCyl = sdf.cylinder(hatBaseR, hatH)
  .taper(-1.90 / hatH)
  .translate([crown[0], crown[1], hatBaseZ + hatH / 2]);

const hat = hatBrim
  .smoothUnion(hatConeCyl, hatBaseR * 0.08)
  .label('hat');

// 8. BEARD — long flowing wizard beard, clearly protruding from chin
// chinPos is at the chin anchor. Front = −Y.
// The beard must be pushed well forward (into negative Y) to be visible from front.
const chinPos = rig.face.chinTip;
// The chin is already on the −Y face of the head. Push beard further forward.
const beardY = chinPos[1] - headR * 0.25;  // noticeably forward of chin surface

// Top blob: wide bushy start
const beardTop = sdf.ellipsoid(headR * 0.38, headR * 0.26, headR * 0.30)
  .translate([chinPos[0], beardY, chinPos[2] - headR * 0.08]);

// Middle: elongated downward
const beardMid = sdf.ellipsoid(headR * 0.32, headR * 0.22, headR * 0.52)
  .translate([chinPos[0], beardY, chinPos[2] - headR * 0.65]);

// Lower: getting narrower
const beardLow = sdf.ellipsoid(headR * 0.26, headR * 0.18, headR * 0.50)
  .translate([chinPos[0], beardY, chinPos[2] - headR * 1.35]);

// Tip: tapered point
const beardTip = sdf.capsule(
  [chinPos[0], beardY, chinPos[2] - headR * 1.70],
  [chinPos[0], beardY, chinPos[2] - headR * 2.40],
  headR * 0.10
);

const kb = headR * 0.22;
const beard = beardTop
  .smoothUnion(beardMid, kb)
  .smoothUnion(beardLow, kb)
  .smoothUnion(beardTip, kb * 0.55)
  .label('beard');

// 9. STAFF + ORB
// Staff is planted on the ground to the figure's left (+X side), slightly forward (−Y).
// It's a tall rod that extends well above the wizard's head, with a glowing orb at the top.
// The left hand grips it — we weld the staff to the hand with a bridge sphere.
const handL = rig.joints.handL;

// Staff position: at the hand's X-position, pushed notably forward (−Y)
// so it's visible from front view and clearly in front of the hat cone
const staffX = handL[0] + headR * 0.15;  // slightly outboard of hand
const staffY = handL[1] - headR * 1.20;  // well forward (−Y) to clearly separate from hat
const staffRodR = rig.r.hand * 0.22;

// Staff goes from ground to above the hat top
const hatTipApproxZ = brimZ + hatH;  // approximate hat tip height
const staffBottomZ = rig.opts.height * 0.04;
const staffTopZ = hatTipApproxZ + headR * 1.0;  // extends notably above hat

// ORB: large glowing sphere above the hat. The rod runs INTO the orb centre
// so the two stay one component across the hard label seam.
const orbR = headR * 0.82;
const orbZ = staffTopZ + orbR * 0.95;
const orbCenter = [staffX, staffY, orbZ];

const staffRod = sdf.capsule(
  [staffX, staffY, staffBottomZ],
  [staffX, staffY, orbZ],          // reaches the orb centre — deep overlap
  staffRodR
);

// Connect to left hand
const handBridgeL = sdf.sphere(rig.r.hand * 0.85).translate(handL);
const staff = staffRod
  .smoothUnion(handBridgeL, rig.r.hand * 0.50)
  .label('staff');

// The orb is its own top-level label region (hard seam against the rod —
// hidden inside the orb), so it paints separately from the wooden staff.
const orb = sdf.sphere(orbR).translate(orbCenter).label('orb');

// 10. Final union and build
// eyes: lifted to top-level so they carry their own paint label.
// detail: F.faceDetail(rig) refines the head mesh for smooth carved smile and round eye domes.
return sdf.union(skin, eyes, robe, hair, hat, beard, staff, orb, base)
  .build({ edgeLength: 0.52, detail: F.faceDetail(rig) });
