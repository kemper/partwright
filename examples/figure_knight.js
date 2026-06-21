// Knight — a showcase of the figure ACCESSORY ATTACHMENT system:
//   • Worn shell  → a plate cuirass (.round over the shirt) + pauldron caps
//   • Ringed      → a belt around the waist (F.ring + F.ringPoint buckle)
//   • Held        → a sword seated in the right fist (F.holdAt)
//   • Hung        → an empty scabbard dangling at the left hip (F.hangFrom)
// Front = −Y, Z up, figure-left = +X, figure-right = −X. ~6.2 heads tall.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — braced stance, right arm raises the sword, left arm relaxed.
const rig = F.rig({
  height: 66, headsTall: 6.2, build: 'average', sex: 'male', muscle: 0.5,
  pose: {
    armR: { raiseSide: 42, raiseFwd: 18, bend: 34 },
    armL: { raiseSide: 11, raiseFwd: 5, bend: 16 },
    legL: { raiseSide: 7 }, legR: { raiseSide: 9, bend: 6 },
    head: { yaw: -6, pitch: -2 }, spine: { turn: 3 },
  },
});
const j = rig.joints, r = rig.r, H = rig.opts.height;

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false, nose: { tipRadius: r.head * 0.09 },
  mouth: { style: 'lips', width: r.head * 0.30 },
  ears: { size: r.head * 0.21 }, brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });

// 3. SKIN — right hand a fist around the grip
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig, { grip: 'fist' }),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. UNDER-TUNIC + PANTS
const shirtThick = r.chestX * 0.12;
const shirt = F.clothing.top(rig, { sleeve: 'short', thickness: shirtThick }).label('shirt');
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');

// 5. CUIRASS (Worn shell) — inflate the bare torso over the shirt, hard-clip to a
// chest→waist band, add a keel ridge, peascod point, fauld rim, and pauldron caps.
const tArmor = shirtThick + r.chestX * 0.09;
const torsoNode = F.torso(rig);
const armorMass = torsoNode.round(tArmor);
const topZ = j.upperArmL[2] - r.upperArm * 0.05;
const botZ = j.spine[2] + r.chestY * 0.10;
const halfX = r.chestX * 1.02 + tArmor * 0.5;
const bigD = (r.chestY + tArmor) * 4;
const zone = sdf.box([halfX * 2, bigD * 2, topZ - botZ]).translate([0, 0, (topZ + botZ) / 2]);
const plate = armorMass.intersect(zone);
const frontY = -(r.chestY + tArmor);
const keel = sdf.capsule([0, frontY * 0.90, topZ - r.chestY * 0.30], [0, frontY * 0.90, botZ + r.chestY * 0.15], r.chestX * 0.20).intersect(zone);
const peascod = sdf.sphere(r.chestX * 0.42).translate([0, frontY * 0.82, botZ + r.chestY * 0.05]);
const neckScoop = sdf.sphere(r.neck * 1.7).translate([0, frontY * 0.6, topZ - r.chestY * 0.12]);
const fauld = torsoNode.round(tArmor + r.chestX * 0.06)
  .intersect(sdf.box([halfX * 2.4, bigD * 2, r.chestY * 0.5]).translate([0, 0, botZ + r.chestY * 0.1]));
const pR = r.upperArm * 1.35 + shirtThick;
const pauldron = (cx, cy, cz) =>
  sdf.ellipsoid(pR * 1.25, pR * 1.05, pR * 0.7).translate([cx, cy, cz])
    .union(sdf.ellipsoid(pR * 1.0, pR * 0.82, pR * 0.5).translate([cx * 1.10, cy, cz - pR * 0.7]));
const armor = plate.union(keel).smoothUnion(peascod, r.chestX * 0.25).union(fauld)
  .smoothSubtract(neckScoop, r.neck * 0.4)
  .smoothUnion(pauldron(j.upperArmL[0] * 1.06, j.upperArmL[1], j.upperArmL[2] + r.upperArm * 0.45), r.upperArm * 0.18)
  .smoothUnion(pauldron(j.upperArmR[0] * 1.06, j.upperArmR[1], j.upperArmR[2] + r.upperArm * 0.45), r.upperArm * 0.18)
  .label('armor');

// 6. BELT (Ringed) + buckle at the front
const beltTube = r.waist * 0.16;
const beltClear = r.upperLeg * 0.30 + beltTube * 0.5 + 0.5;
const beltFrame = rig.ring.waist;
const beltBand = F.ring(beltFrame, { tube: beltTube, clearance: beltClear, segments: 56 });
const bucklePt = F.ringPoint(beltFrame, 0, { clearance: beltClear });
const buckle = sdf.roundedBox([beltTube * 3, beltTube * 2, beltTube * 2.6], beltTube * 0.28).translate(bucklePt);
const belt = beltBand.union(buckle).label('belt');

// 7. SWORD (Held) — built along +Z centred at origin, then seated in the right fist.
const gripLen = r.hand * 2.2, gripR = r.hand * 0.26;
const guardW = r.hand * 3.8, guardH = r.hand * 0.34, guardD = r.hand * 0.70;
const bladeLen = H * 0.58, bladeW = r.hand * 0.65, bladeT = r.hand * 0.34;
const pommelR = r.hand * 0.40;
const pommelZ = -gripLen * 0.55, guardZ = gripLen * 0.55;
const grip = sdf.capsule([0, 0, pommelZ], [0, 0, guardZ], gripR);
const guard = sdf.roundedBox([guardW, guardD, guardH * 2], guardH * 0.2).translate([0, 0, guardZ]);
const bladeBase = sdf.roundedBox([bladeW * 2, bladeT * 2, bladeLen * 0.55], bladeT * 0.25).translate([0, 0, guardZ + bladeLen * 0.275]);
const bladeUpper = sdf.roundedBox([bladeW * 1.2, bladeT * 1.5, bladeLen * 0.50], bladeT * 0.20).translate([0, 0, guardZ + bladeLen * 0.725]);
const bladeTip = sdf.sphere(r.hand * 0.35).translate([0, 0, guardZ + bladeLen]);
const blade = bladeBase.smoothUnion(bladeUpper, bladeT * 0.6).smoothUnion(bladeTip, bladeT * 0.5);
const pommel = sdf.sphere(pommelR).translate([0, 0, pommelZ]);
const swordLocal = grip.union(guard).union(blade).smoothUnion(pommel, pommelR * 0.25);
const heldSword = F.holdAt(swordLocal, rig.grip.R);
const swordBridge = sdf.capsule(j.handR, rig.grip.R.point, r.hand * 0.55);
const sword = heldSword.smoothUnion(swordBridge, r.hand * 0.4).label('sword');

// 8. SCABBARD (Hung) — empty sheath dangling at the left hip from the belt.
const scabLen = bladeLen + gripLen * 0.3, scabW = r.hand * 1.10, scabT = r.hand * 0.70, scabTube = r.hand * 0.28;
const collarH = r.hand * 0.90, collarR = scabW * 0.90;
const scabBody = sdf.roundedBox([scabW * 2, scabT * 2, scabLen * 0.90], scabTube).translate([0, 0, -scabLen * 0.45]);
const collar = sdf.cylinder(collarR, collarH).translate([0, 0, collarH * 0.5]);
const chape = sdf.sphere(scabW * 0.80).translate([0, 0, -scabLen * 0.92]);
const scabLocal = scabBody.smoothUnion(collar, scabTube * 0.8).smoothUnion(chape, scabTube * 0.8);
const scabClear = beltClear + r.hand * 0.5;
const hipPt = F.ringPoint(beltFrame, 85, { clearance: scabClear });
const hungScab = F.hangFrom(scabLocal, hipPt, { tilt: 20, anchor: 'top' });
const frogBelt = F.ringPoint(beltFrame, 85, { clearance: beltClear });
const frog = sdf.capsule(frogBelt, [hipPt[0], hipPt[1], hipPt[2] + collarH * 0.3], scabTube * 0.8);
const scabbard = hungScab.union(frog).label('scabbard');

// 9. HAIR + BASE
const hair = F.hair(rig, { style: 'short' }).label('hair');
const base = F.base(rig, { radius: H * 0.26 }).label('base');

// 10. COLOR (in-code paint, so it bakes self-coloured — no palette file needed)
api.paint.label('skin', '#c89a6a');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5b6e8c');
api.paint.label('pupil', '#161616');
api.paint.label('lids', '#c89a6a');
api.paint.label('hair', '#4a3526');
api.paint.label('shirt', '#6e4a35');
api.paint.label('pants', '#3a3326');
api.paint.label('armor', '#b9c0c9');   // steel
api.paint.label('belt', '#3a2417');
api.paint.label('sword', '#cfd4da');   // bright blade/steel
api.paint.label('scabbard', '#5a3a22');
api.paint.label('base', '#54504a');

return sdf.union(skin, eyes, shirt, pants, armor, belt, sword, scabbard, hair, base)
  .build({ edgeLength: 0.42, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
