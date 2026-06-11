// Rock guitarist — mid-solo, electric guitar slung across the body,
// bangs hair, open singing mouth, wide stance. ~7 heads tall.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — wide power stance; left arm raised (fretting up the neck),
// right arm forward/down over the body (strumming).
// 7 heads tall = adult hero proportions.
const rig = F.rig({
  height: 64,
  headsTall: 7,
  build: 'slim',
  pose: {
    // Left arm: raised high and forward, elbow bent so forearm goes upward toward the neck.
    // abduct 62 = arm raised; flex 58 = forward component; twist +90 = hinge flipped so elbow sweeps upward; elbow 72 = forearm curls up toward neck
    armL: { abduct: 62, flex: 58, elbow: 72, twist: 90 },
    // Right arm: strumming — slightly out and forward, elbow bent to bring hand down to body.
    // abduct 20 = arm slightly out; flex 38 = forward; twist 60 = hinge rotated so forearm curves down; elbow 55 = forearm toward guitar body
    armR: { abduct: 20, flex: 38, elbow: 55, twist: 60 },
    // Wide rock stance
    legL: { abduct: 26 },
    legR: { abduct: 26 },
    // Head up slightly — open mouth visible from front (not hidden by jaw)
    head: { turn: -8, tilt: 4, nod: -5 },
    // Backward lean — rock energy
    spine: { lean: -5, side: -2 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — open singing mouth (wide gape, teeth visible).
const mouthOpts = { style: 'open', open: 0.74, width: r.head * 0.52 };
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.10 },
  mouth: mouthOpts,
  ears: { size: r.head * 0.22 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14 });
const mouthParts = F.face.mouthAccents(rig, mouthOpts);  // 'teeth' + 'lips' labels

// 3. SKIN — relaxed grip on both hands.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — band tee + slim jeans.
const tee = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestX * 0.15,
}).label('tee');

const jeans = F.clothing.pants(rig, {
  leg: 'slim',
  rise: 'mid',
  thickness: r.thigh * 0.22,
}).label('jeans');

// 5. HAIR — bangs (fringe).
const hair = F.hair(rig, { style: 'bangs' }).label('hair');

// 6. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.27 }).label('base');

// 7. GUITAR — electric guitar slung on a strap across the body.
//
// Guitar geometry:
//   • The guitar BODY has two bouts (roundedCylinder, rotate([90,0,0]) to face front).
//   • The guitar is tilted diagonally: lower-bout at lower-right, upper-bout at upper-left.
//   • The NECK rises from the upper bout diagonally toward the fretting (left) hand.
//   • Bridge capsules connect each hand to the guitar so everything is one piece.
//
// Reference joints
const pelvis = j.pelvis;
const hL = j.handL;
const hR = j.handR;

// ---- Guitar body geometry ----
// The guitar body "center" is just a reference point; the two bouts are offset from it.
// Put the lower bout at right-hip level, well in front of the figure's torso.
// Put the upper bout shifted up-and-left (diagonal tilt of the guitar).

// Lower bout center (right side, lower, well forward of torso)
const lbX = pelvis[0] - r.head * 0.50;        // toward figure's right (−X)
const lbY = pelvis[1] - r.head * 2.20;        // well forward of torso front surface
const lbZ = pelvis[2] - r.head * 0.20;        // just below pelvis height (low guitar)
const lowerCenter = [lbX, lbY, lbZ];

// Upper bout center: displaced up-and-left from the lower bout (diagonal guitar tilt)
const ubX = lbX + r.head * 1.30;              // toward figure's left (+X)
const ubY = lbY + r.head * 0.25;              // slightly back
const ubZ = lbZ + r.head * 1.30;              // up
const upperCenter = [ubX, ubY, ubZ];

// Waist center: between the bouts, at the narrowing
const wX = (lbX + ubX) * 0.5;
const wY = (lbY + ubY) * 0.5;
const wZ = (lbZ + ubZ) * 0.5;

// Bout parameters — roundedCylinder axis is Z by default.
// rotate([90,0,0]) tilts axis to Y, making the circular face face front (−Y) and back (+Y).
const boutH     = r.head * 1.0;   // guitar body depth (front-to-back after rotate)
const boutRound = r.head * 0.13;

// Lower bout (larger)
const bLR = r.head * 0.96;
const lowerBout = sdf.roundedCylinder(bLR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(lowerCenter);

// Upper bout (smaller)
const bUR = r.head * 0.76;
const upperBout = sdf.roundedCylinder(bUR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(upperCenter);

// Guitar waist narrowing
const waistR = r.head * 0.38;
const guitarWaist = sdf.roundedCylinder(waistR, boutH * 1.1, boutRound * 0.5)
  .rotate([90, 0, 0])
  .translate([wX, wY, wZ]);

// Smooth-union bouts through the waist. Small k keeps the hourglass shape legible.
const guitarBody = lowerBout
  .smoothUnion(guitarWaist, r.head * 0.20)
  .smoothUnion(upperBout, r.head * 0.20);

// ---- Guitar neck ----
// Neck runs from the neck-joint of the upper bout diagonally toward the fretting hand.
// Direction: from upper bout up-and-left toward hL.
const neckStart = [
  upperCenter[0] + r.head * 0.55,   // left edge of upper bout
  upperCenter[1],                    // same Y depth as body
  upperCenter[2] + bUR * 0.70,      // near top of upper bout
];

// Neck end: near the fretting hand, slightly beyond it
const neckEnd = [
  hL[0] + r.hand * 0.6,    // slightly beyond fretting hand (leftward +X)
  lbY + r.head * 0.15,     // keep neck in the same "guitar plane" (forward Y)
  hL[2] + r.hand * 0.5,    // slightly above fretting wrist
];

const neckR = r.hand * 0.26;
const neckCaps = sdf.capsule(neckStart, neckEnd, neckR);

// Headstock: wider capsule extending beyond the neck end
const nDir = [neckEnd[0] - neckStart[0], neckEnd[1] - neckStart[1], neckEnd[2] - neckStart[2]];
const nLen = Math.hypot(...nDir);
const nN = nDir.map(v => v / nLen);
const hsEnd = [
  neckEnd[0] + nN[0] * r.head * 0.55,
  neckEnd[1] + nN[1] * r.head * 0.55,
  neckEnd[2] + nN[2] * r.head * 0.55,
];
// Headstock capsule starts FROM neckEnd (guaranteed overlap) → extra width reads as headstock
const headstock = sdf.capsule(neckEnd, hsEnd, r.hand * 0.52);

// ---- Bridge capsules: hand → guitar ----
//
// Strumming (right) hand → lower bout front face.
// The bridge capsule goes from hR to the front surface of the lower bout.
const strumTarget = [
  lbX,                   // lower bout center X
  lbY - boutH * 0.30,   // front face of the guitar body (−Y direction from center)
  lbZ + r.head * 0.05,  // near lower bout center Z
];
const bridgeR = sdf.capsule(hR, strumTarget, r.hand * 0.55);

// Fretting (left) hand → guitar neck axis near the hand.
// tFrac interpolates along the neck axis to the point closest to hL.
const tFrac = 0.80;
const fretTarget = [
  neckStart[0] + nDir[0] * tFrac,
  neckStart[1] + nDir[1] * tFrac,
  neckStart[2] + nDir[2] * tFrac,
];
const bridgeL = sdf.capsule(hL, fretTarget, r.hand * 0.52);

// ---- Assemble guitar ----
const guitar = guitarBody
  .smoothUnion(neckCaps, r.hand * 0.40)
  .smoothUnion(headstock, r.hand * 0.42)
  .smoothUnion(bridgeR, r.hand * 0.48)
  .smoothUnion(bridgeL, r.hand * 0.48)
  .label('guitar');

// 8. Union + build.
return sdf.union(skin, eyes, mouthParts, tee, jeans, hair, guitar, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
