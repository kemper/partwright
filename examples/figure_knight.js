// Knight — showcase of the figure ACCESSORY ATTACHMENT system:
//   • Worn shell  → a plate cuirass LAYERED over the shirt (offset the clothed
//                   surface, the way clothing offsets skin) + pauldron caps
//   • Ringed      → a belt conformed to the body (F.ring with `surface`)
//   • Held        → a sharp tapered sword seated in the right fist (F.holdAt)
//   • Hung        → an empty scabbard dangling clear of the leg (F.hangFrom)
// Front = −Y, Z up, figure-left = +X, figure-right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — braced stance, right arm raises the sword, left arm relaxed.
const rig = F.rig({
  height: 66, headsTall: 6.2, build: 'average', sex: 'male', muscle: 0.5,
  pose: {
    armR: { raiseSide: 12, raiseFwd: 35, bend: 80, thumb: 'in' },
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
  mouth: { style: 'lips', width: r.head * 0.30 }, ears: { size: r.head * 0.21 }, brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });

// 3. SKIN — right hand a fist around the grip
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig, { grip: 'fist' }),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. UNDER-TUNIC + PANTS
const shirtThick = r.chestX * 0.12;
const shirt = F.clothing.top(rig, { sleeve: 'long', thickness: shirtThick }).label('shirt');
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');

// 5. CUIRASS (Worn shell) — LAYER over the shirt by offsetting the SHIRT surface
// (so the shirt can never poke through), then clip to a chest→waist band and add
// a keel ridge, peascod point, fauld rim, and pauldron caps.
const armorGap = r.chestX * 0.08;          // the plate's standoff/thickness over the shirt
const armorMass = shirt.round(armorGap);   // guaranteed OUTSIDE the shirt everywhere
const topZ = j.upperArmL[2] - r.upperArm * 0.05;
const botZ = j.spine[2] + r.chestY * 0.10;
const halfX = r.chestX * 1.02 + shirtThick + armorGap;
const bigD = (r.chestY + shirtThick + armorGap) * 4;
const zone = sdf.box([halfX * 2, bigD * 2, topZ - botZ]).translate([0, 0, (topZ + botZ) / 2]);
const plate = armorMass.intersect(zone);
const frontY = -(r.chestY + shirtThick + armorGap);
const keel = sdf.capsule([0, frontY * 0.92, topZ - r.chestY * 0.30], [0, frontY * 0.92, botZ + r.chestY * 0.15], r.chestX * 0.20).intersect(zone);
const peascod = sdf.sphere(r.chestX * 0.42).translate([0, frontY * 0.85, botZ + r.chestY * 0.05]);
const neckScoop = sdf.sphere(r.neck * 1.7).translate([0, frontY * 0.6, topZ - r.chestY * 0.12]);
const fauld = shirt.round(armorGap + r.chestX * 0.06)
  .intersect(sdf.box([halfX * 2.4, bigD * 2, r.chestY * 0.5]).translate([0, 0, botZ + r.chestY * 0.1]));
const pR = r.upperArm * 1.35 + shirtThick + armorGap;
const pauldron = (cx, cy, cz) =>
  sdf.ellipsoid(pR * 1.25, pR * 1.05, pR * 0.7).translate([cx, cy, cz])
    .union(sdf.ellipsoid(pR * 1.0, pR * 0.82, pR * 0.5).translate([cx * 1.10, cy, cz - pR * 0.7]));
// Cuirass = the torso shell (arm-occluded by F.layers, so it terminates at the
// SLEEVE and never bleeds onto the arm beside the torso). Pauldrons = the shoulder
// caps, which legitimately sit ON the upper arms — a SEPARATE layer that is NOT
// arm-occluded (otherwise the limb-occlusion would eat them).
const cuirass = plate.union(keel).smoothUnion(peascod, r.chestX * 0.25).union(fauld)
  .smoothSubtract(neckScoop, r.neck * 0.4)
  .label('armor');
const pauldrons = pauldron(j.upperArmL[0] * 1.06, j.upperArmL[1], j.upperArmL[2] + r.upperArm * 0.45)
  .union(pauldron(j.upperArmR[0] * 1.06, j.upperArmR[1], j.upperArmR[2] + r.upperArm * 0.45))
  .label('armor');

// Clothed-body surface (skin + shirt + pants) for conforming the belt band and
// the scabbard hip anchor; the band's `rig` occluder carves the arms away.
const clothed = sdf.union(skin, shirt, pants);

// 6. BELT (Ringed) — a FLUSH band (F.band), not a round tube: it slices the
// CLOTHED body grown just proud of the shirt, so it lies FLAT against the body the
// way a real belt does. Arm-occlusion is handled by F.layers below (occludeArms),
// so the belt wraps the torso and terminates at the SLEEVE, not the bare arm.
const beltClear = shirtThick + r.chestX * 0.02;
const beltBand = F.band(rig.ring.waist, {
  surface: clothed, thickness: r.waist * 0.12, height: r.chestX * 0.62, clearance: beltClear,
});
const bucklePt = F.ringPoint(rig.ring.waist, 0, { surface: clothed, clearance: beltClear });
const buckle = sdf.roundedBox([r.waist * 0.5, r.waist * 0.3, r.chestX * 0.52], r.waist * 0.06).translate(bucklePt);
const belt = beltBand.union(buckle).label('belt');

// 7. SWORD (Held) — a SHARP tapered blade: flat diamond cross-section narrowing
// to a point, a crisp wide cross-guard, a grip, and a disc pommel. Built along
// +Z centred at origin, then seated in the right fist.
const gripLen = r.hand * 2.2, gripR = r.hand * 0.24;
const guardW = r.hand * 3.6, guardH = r.hand * 0.30, guardD = r.hand * 0.62;
const bladeLen = H * 0.62, bladeHalfW = r.hand * 0.42, bladeHalfT = r.hand * 0.14;
const pommelR = r.hand * 0.42;
const pommelZ = -gripLen * 0.55, guardZ = gripLen * 0.55;
const grip = sdf.capsule([0, 0, pommelZ], [0, 0, guardZ], gripR);
const guard = sdf.roundedBox([guardW, guardD, guardH * 2], guardH * 0.18).translate([0, 0, guardZ]);
// Blade: a flat (wide X, thin Y) bar whose WIDTH tapers to a point while its
// THICKNESS stays constant — so it can't pinch in two axes and shed the tip as a
// floating sliver. Intersect a constant-thickness slab with a width-tapering
// wedge whose Y is huge (so `taper`, which scales both X and Y, never thins the
// blade below bladeHalfT). `taper` is anchored at z=0 → base at z=0, tip +bladeLen.
const taperRate = -0.7 / bladeLen;   // tip ~30% width — pointed but printable
const bladeSlab = sdf.roundedBox([bladeHalfW * 2, bladeHalfT * 2, bladeLen], bladeHalfT * 0.7)
  .translate([0, 0, bladeLen * 0.5]);
const bladeWedge = sdf.box([bladeHalfW * 2, bladeHalfW * 8, bladeLen])
  .translate([0, 0, bladeLen * 0.5])
  .taper(taperRate, 'z');
const blade = bladeSlab.intersect(bladeWedge).translate([0, 0, guardZ]);
const pommel = sdf.cylinder(pommelR, pommelR * 0.7).rotate([90, 0, 0]).translate([0, 0, pommelZ]);
const swordLocal = grip.union(guard).smoothUnion(blade, bladeHalfT * 0.5).smoothUnion(pommel, pommelR * 0.3);
const heldSword = F.holdAt(swordLocal, rig.grip.R);
const swordBridge = sdf.capsule(j.handR, rig.grip.R.point, r.hand * 0.5);
const sword = heldSword.smoothUnion(swordBridge, r.hand * 0.4).label('sword');

// 8. SCABBARD (Hung) — empty sheath at the left hip, pushed OUT past the thigh
// and hung near-vertical so it clears the leg/clothes.
// Length kept short enough that the chape clears the base disc (hip sits at
// z≈34.6 and the figure is 66 tall — a full-blade-length sheath would poke below
// the ground), hung with a slight backward tilt so the tip rides behind the calf.
const scabLen = bladeLen * 0.68 + gripLen * 0.3, scabW = r.hand * 0.95, scabT = r.hand * 0.55, scabTube = r.hand * 0.24;
const collarH = r.hand * 0.85, collarR = scabW * 0.95;
const scabBody = sdf.roundedBox([scabW * 2, scabT * 2, scabLen * 0.90], scabTube).translate([0, 0, -scabLen * 0.45]);
const collar = sdf.cylinder(collarR, collarH).translate([0, 0, collarH * 0.5]);
const chape = sdf.sphere(scabW * 0.80).translate([0, 0, -scabLen * 0.92]);
const scabLocal = scabBody.smoothUnion(collar, scabTube * 0.8).smoothUnion(chape, scabTube * 0.8);
// Anchor on the clothed surface at the left hip, then push further out so the
// sheath hangs beside (not through) the leg.
const hipPt0 = F.ringPoint(rig.ring.waist, 92, { surface: clothed });
const outDir = [hipPt0[0] - rig.ring.waist.center[0], hipPt0[1] - rig.ring.waist.center[1], 0];
const outLen = Math.hypot(outDir[0], outDir[1]) || 1;
const hipPt = [hipPt0[0] + (outDir[0] / outLen) * r.hand * 1.1, hipPt0[1] + (outDir[1] / outLen) * r.hand * 1.1, hipPt0[2]];
const hungScab = F.hangFrom(scabLocal, hipPt, { tilt: -10, anchor: 'top' });
const frog = sdf.capsule(hipPt0, [hipPt[0], hipPt[1], hipPt[2] + collarH * 0.3], scabTube * 0.8);
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
api.paint.label('armor', '#b9c0c9');
api.paint.label('belt', '#3a2417');
api.paint.label('sword', '#cfd4da');
api.paint.label('scabbard', '#5a3a22');
api.paint.label('base', '#54504a');

// 11. LAYERS — composite the body + garment stack with priority + automatic
// limb-occlusion (the architecture that kills armor-bleeds-onto-arm). Higher
// priority wins where two collide; `occludeArms` carves the SLEEVE-dilated arms
// from the torso plate/belt so neither bleeds onto a limb. The base body is
// carve:false (never trimmed — and the fine-hands marker must stay un-buried).
// Standalone props (eyes, sword, scabbard, hair, base) are plain-unioned on top.
const sleeve = shirtThick + r.chestX * 0.02;
// shirt/pants are carve:false (the cuirass already offsets OUTWARD from the shirt
// so it can't poke through — no priority-carve needed, which keeps their partitions
// cheap to mesh). Only the belt + cuirass pay for arm-occlusion (the bleed fix).
const body = F.layers(rig, [
  { node: skin, carve: false, priority: 0 },
  { node: shirt, carve: false, priority: 1 },
  { node: pants, carve: false, priority: 1 },
  { node: belt, carve: false, priority: 2, occludeArms: sleeve },
  { node: cuirass, carve: false, priority: 3, occludeArms: armorGap + shirtThick },
  { node: pauldrons, carve: false, priority: 3 },
]);

return sdf.union(body, eyes, sword, scabbard, hair, base)
  .build({ edgeLength: 0.42, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
