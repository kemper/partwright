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
    // Left arm: fretting hand raised IN FRONT of the left shoulder (not splayed
    // out to the side) to grip the guitar neck. abduct=20 keeps the upper arm
    // close in; flex=55 sweeps it forward; a deep elbow=120 curl folds the
    // forearm up so the hand lands just left of the shoulder near the guitar's
    // depth plane (≈ [6.5, −7.4, 58]). The neck is then drawn TO this hand.
    armL: { abduct: 20, flex: 55, elbow: 120, twist: 0 },
    // Right arm: strumming hand drops DOWN over the lower guitar body.
    // Low abduct and flex=20 hang the arm at waist height; elbow=0 keeps it
    // straight so the hand hovers just in front of the lower bout.
    armR: { abduct: 0, flex: 20, elbow: 0, twist: 0 },
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
// Design: The guitar BODY overlaps the torso (belly/navel area) so the union
// is face-connected — no thick bridge capsules needed. The neck rises diagonally
// toward the upper-left. Hands are posed close enough to rest on guitar naturally.
//
// Reference joints
const navel = j.navel;

// ---- Guitar body position ----
// Guitar is slung diagonally: lower-bout at navel-right, upper-bout at lower-chest-left.
// The body is pushed well in front of the torso (−Y) so it faces the viewer, but
// overlaps the torso skin by ~1 unit so the boolean union is solid (one piece).

// Guitar body front-to-back depth (axis along Y after rotation)
const boutH = r.head * 0.85;        // guitar body depth (compact, readable)
const boutRound = r.head * 0.11;

// Lower bout: hip/navel height, shifted more to figure's right (−X), pushed well forward (−Y).
// The guitar is slung low and to the right. The back of the guitar body (lbY + boutH/2)
// remains inside the torso skin to guarantee one-piece union without bridge capsules.
const lbX = navel[0] - r.head * 1.00;   // figure's right — shifted right to clear the right hip
const lbY = navel[1] - r.head * 1.10;   // pushed forward — guitar protrudes clearly in front of belly
const lbZ = navel[2] - r.head * 0.10;   // at navel height
const lowerCenter = [lbX, lbY, lbZ];

// Upper bout: shifted up-and-left (diagonal tilt like a real slung guitar)
const ubX = lbX + r.head * 1.30;        // figure's left (+X) — reaches toward center of torso
const ubY = lbY + r.head * 0.05;        // nearly same depth
const ubZ = lbZ + r.head * 1.40;        // up about 1.4 heads — chest height
const upperCenter = [ubX, ubY, ubZ];

// Guitar waist (hourglass narrowing between bouts)
const wX = (lbX + ubX) * 0.50;
const wY = (lbY + ubY) * 0.50;
const wZ = (lbZ + ubZ) * 0.50;

// Bout radii — slightly larger for readability at figurine scale
const bLR = r.head * 0.92;   // lower bout radius (larger)
const bUR = r.head * 0.74;   // upper bout radius (smaller)
const waistR = r.head * 0.36; // waist narrowing

// roundedCylinder default axis = Z; rotate([90,0,0]) makes axis = Y, face = front/back.
const lowerBout = sdf.roundedCylinder(bLR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(lowerCenter);

const upperBout = sdf.roundedCylinder(bUR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(upperCenter);

const guitarWaist = sdf.roundedCylinder(waistR, boutH * 1.05, boutRound * 0.5)
  .rotate([90, 0, 0])
  .translate([wX, wY, wZ]);

// Smooth-union bouts through the waist — small k preserves the hourglass silhouette
const guitarBody = lowerBout
  .smoothUnion(guitarWaist, r.head * 0.18)
  .smoothUnion(upperBout, r.head * 0.18);

// ---- Guitar neck ----
// Neck axis: from upper-left edge of upper bout, rising diagonally up-and-left
// toward the figure's left shoulder area (where the fretting hand reaches).
const neckStartX = upperCenter[0] + r.head * 0.30;  // left edge of upper bout
const neckStartY = upperCenter[1];                    // same guitar plane (well forward)
const neckStartZ = upperCenter[2] + bUR * 0.60;      // near top of upper bout

// Neck end: drawn directly TO the fretting hand so the neck always reaches it
// (in all three axes) regardless of the exact FK — the hand grips near the top
// of the neck, the headstock extends just beyond. This rises steeply up-and-left
// from the upper bout to the hand (≈ [6.5, −7.4, 58]), reading as a normal neck.
const neckStart = [neckStartX, neckStartY, neckStartZ];
const neckEnd   = [j.handL[0], j.handL[1], j.handL[2]];

const neckR = r.hand * 0.30;
const neckCaps = sdf.capsule(neckStart, neckEnd, neckR);

// Headstock: wider slab extending beyond the neck tip along the same diagonal
const nDir = [neckEnd[0] - neckStart[0], neckEnd[1] - neckStart[1], neckEnd[2] - neckStart[2]];
const nLen = Math.hypot(...nDir);
const nN = nDir.map(v => v / nLen);
const hsLen = r.head * 0.52;
const hsEnd = [
  neckEnd[0] + nN[0] * hsLen,
  neckEnd[1] + nN[1] * hsLen,
  neckEnd[2] + nN[2] * hsLen,
];
const headstock = sdf.capsule(neckEnd, hsEnd, r.hand * 0.44);

// ---- Assemble guitar ----
// No bridge capsules needed:
// • The neck (neckR=r.hand*0.30) is extended in X and Z to meet the fretting hand.
// • Right hand is at the front face of the lower bout (within the bout's rounded
//   edge) — the skin union already fuses them into one solid.
const guitar = guitarBody
  .smoothUnion(neckCaps, r.hand * 0.35)
  .smoothUnion(headstock, r.hand * 0.38)
  .label('guitar');

// 8. Union + build.
return sdf.union(skin, eyes, mouthParts, tee, jeans, hair, guitar, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
