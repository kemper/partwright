// Witch Casting a Spell — a hunched old witch, one hand raised forward throwing
// a spell with open fingers, the other gripping a gnarled staff. Pointed hat,
// intense side gaze, long stringy gray hair, robe + boots.
// ~7 heads tall, slim, age 70. Front = −Y, Z up, figure's left = +X, right = −X.
//
// SHOWCASE: F.placeOnHead (pointed witch hat seated ON the hair, embedded so it
// welds) + a gnarled vertical staff welded into the LEFT fist. Because the left
// arm hangs down, its gripAxis is nearly HORIZONTAL — so the staff is built
// upright at the grip point (not via F.holdAt, which would lay it sideways) and
// bridged into the fist. Everything fuses into ONE printable component.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — leaning forward, casting. Right arm raised forward (open hand throwing
// the spell), left arm down gripping the staff.
const rig = F.rig({
  height: 58,
  headsTall: 7,
  sex: 'female',
  build: 'slim',
  age: 70,
  weight: 0.45,
  pose: {
    // Right arm: raised forward, open hand throwing the spell out front.
    armR: { raiseSide: 55, raiseFwd: 45, bend: 30, twist: 0 },
    // Left arm: down at the side, slight bend, fist gripping the staff.
    armL: { raiseSide: 14, raiseFwd: 4, bend: 18 },
    legL: { raiseSide: 8 },
    legR: { raiseSide: 8 },
    // Head forward, gaze cast to the side, intense.
    head: { yaw: -10, pitch: 6, roll: -2 },
    // Hunched forward over the spell.
    spine: { lean: 15 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — long pointed chin, high cheekbones, hooked aquiline nose,
// hooded lids with a sideways gaze, thin frowning lips.
const head = F.head(rig, { faceShape: 'long', chin: 1.4, cheek: 1.3 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'aquiline', tipRadius: r.head * 0.10 },
  mouth: { style: 'lips', lipShape: 'thin', expression: 'slightFrown', width: r.head * 0.30 },
  ears: true,
  brows: { lift: 0.1, thickness: 1.1 },
});
// Hooded lids, intense gaze cast to the figure's right (toward where the spell flies).
// Proud (larger) eyeballs and a LIGHT hood + modest gaze so the sclera/iris band
// stays wide enough to mesh — a heavy hood on this small head buries the iris and
// sclera (their labels collapse to 0 triangles). The pupil sits low/centre and
// reads through; lifting the hood off it is what makes the iris/sclera resolve.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.17,
  lids: { upper: 0.18, lower: 0.06 },
  gaze: { yaw: -6, pitch: 0 },
});

// 3. SKIN — relaxed grip: the casting right hand reads as open-ish fingers and
// the left fingers curl around the staff. (One grip applies to both hands; the
// staff welds firmly into the left hand via its bridge below regardless.)
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. ROBE — long sleeved witch robe, hem well below the pelvis to a flared skirt.
const robe = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.opts.height * 0.14,
  thickness: r.chestX * 0.16,
}).label('robe');

// 5. BOOTS — owns its 'boots' upper + 'sole' regions.
const boots = F.clothing.boots(rig, { label: 'boots' });

// 6. HAIR — long stringy gray, strand texture.
const hair = F.hair(rig, { style: 'long', texture: 'strands' }).label('hair');

// 7. HAT — a POINTED witch hat: a wide thin brim disc + a tall sharp cone, built
// centred on the ORIGIN (brim in the z=0 plane, cone rising +Z), then seated ON
// the hair with placeOnHead. The cone base is grown near the hair radius and the
// embed sunk deep so the hat fuses to the hair as ONE piece.
const brimR = r.head * 1.7;
const brimH = r.head * 0.13;
const brim = sdf.cylinder(brimR, brimH).translate([0, 0, brimH / 2]);
// Tall, SHARP cone. taper scales the cross-section by (1 + rate·z) about the
// origin, and a cylinder is centred on the origin — so for a cone spanning
// [−H/2, +H/2], rate = −1.9/H drives the top cross-section to ~0 (a sharp point)
// while the base stays full. Translate the base onto the brim so it rises +Z.
const coneBaseR = r.head * 0.85;
const coneH = r.head * 3.6;
const cone = sdf.cylinder(coneBaseR, coneH)
  .taper(-1.9 / coneH, 'z')
  .translate([0, 0, brimH * 0.5 + coneH / 2]);
// SMALL blend so the cone keeps its conical profile where it meets the brim.
const hatLocal = brim.smoothUnion(cone, r.head * 0.1);
const hat = F.placeOnHead(hatLocal, rig, { rest: hair, embed: r.head * 0.6 }).label('hat');

// 8. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 9. STAFF — a gnarled, tapered, near-vertical staff welded into the LEFT fist.
// The left grip cup sits at j ≈ [8.5, -4.8, 27.5]; the staff stands upright there,
// running from below the fist down to the ground and up past the head to a knobby
// crown. Built directly in world space (the arm hangs down, so the horizontal
// gripAxis would lay a holdAt staff sideways — we want it UPRIGHT instead).
const gp = rig.grip.L.point;          // grip cup, the staff's contact line
const staffR = r.hand * 0.42;          // a slim shaft (NO exploding taper — taper
                                       // about z=0 would multiply the thickness up
                                       // the long shaft, so the rod stays uniform).
const groundZ = rig.sole.L.groundZ;    // staff reaches the base
const topZ = j.crown[2] + r.head * 0.9; // ends a little above the head
// Near-vertical: bottom on the ground below the grip, top barely leaning back.
const botPt = [gp[0], gp[1] + r.head * 0.05, groundZ];
const topPt = [gp[0], gp[1] - r.head * 0.20, topZ];
let rod = sdf.capsule(botPt, topPt, staffR);
// A couple of gnarls hugging the shaft (centred ON the rod, near the grip where
// it's solidly inside the capsule, so nothing detaches).
const knob = (z, rad) => sdf.sphere(rad).translate([gp[0] + staffR * 0.3, gp[1], z]);
rod = rod
  .smoothUnion(knob(gp[2] + r.head * 1.4, staffR * 1.4), staffR * 1.0)
  .smoothUnion(knob(gp[2] - r.head * 1.2, staffR * 1.3), staffR * 1.0);
// Knobby gnarled crown at the very top.
const crownKnob = sdf.sphere(staffR * 1.8).translate(topPt);
let staffSolid = rod.smoothUnion(crownKnob, staffR * 0.8);
// Weld bridge from the hand centre to the grip cup so the staff fuses to the fist.
const bridge = sdf.capsule(j.handL, gp, r.hand * 0.6);
const staff = staffSolid.smoothUnion(bridge, r.hand * 0.5).label('staff');

// 10. Union + build.
return sdf.union(skin, eyes, robe, boots, hair, hat, staff, base)
  .build({
    edgeLength: 0.65,
    detail: [
      ...F.faceDetail(rig, { edgeLength: rig.r.head * 0.02, eyeEdgeLength: rig.r.head * 0.004, irisEdgeLength: rig.r.head * 0.002 }),
      ...F.handDetail(rig),
    ],
  });
