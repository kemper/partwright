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
// Uses the new grip-frame API: rig.grip.L/.R give the exact cup where a held
// cylinder rests in the curled fingers — offset toward the palm from the hand
// centre. The neck end is aimed at gL.point (fretting cup), NOT j.handL (the
// hand centre), so the neck seats in the finger curl instead of impaling the
// palm. The body is positioned near gR.point (strumming cup) so the right hand
// rests on the lower bout.
//
const gL = rig.grip.L;   // fretting (left)  grip frame
const gR = rig.grip.R;   // strumming (right) grip frame

// ---- Guitar body — upright plate, face toward −Y ----
// The body is UPRIGHT (flat face toward the viewer, Z is up). Do NOT tilt the
// body into the neck axis direction — that is what caused the "crooked" look.
// boutH is the front-to-back depth. A shallow disc (0.70*r.head) keeps genus
// low (no topological tunnel from overlapping a curved torso surface).
const boutH     = r.head * 0.70;   // guitar body depth (shallow disc)
const boutRound = r.head * 0.10;

// Lower bout: X at the strumming cup, Y pulled slightly back from gR.point
// so the arms connect the guitar to the torso (no large free-floating gap in
// the rendered silhouette). The right arm bridges guitar to torso.
const lbX = gR.point[0];
const lbY = gR.point[1] + r.head * 0.55;  // pull back ~half a head toward body
const lbZ = gR.point[2] - r.head * 0.15;  // just below strumming cup height
const lowerCenter = [lbX, lbY, lbZ];

// Upper bout: same depth (UPRIGHT body), shifted up and toward torso centre.
const ubX = lbX + r.head * 1.05;
const ubY = lbY;                     // same depth — body stays upright
const ubZ = lbZ + r.head * 1.45;    // up ≈ 1.45 heads → lower-chest height
const upperCenter = [ubX, ubY, ubZ];

// Waist: a narrower section midway between the bouts — this is what turns the
// body from a featureless paddle into a guitar figure-8 silhouette.
const wX = (lbX + ubX) * 0.5;
const wY = lbY;
const wZ = (lbZ + ubZ) * 0.5;

// Bout radii — bigger bouts + a pinched waist read as a real guitar body.
const bLR    = r.head * 1.12;   // lower bout radius (larger)
const bUR    = r.head * 0.88;   // upper bout radius (smaller)
const waistR = r.head * 0.50;   // pinched waist

// roundedCylinder default axis = Z; rotate([90,0,0]) → axis = Y, face = ±Y.
const lowerBout = sdf.roundedCylinder(bLR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(lowerCenter);

const upperBout = sdf.roundedCylinder(bUR, boutH, boutRound)
  .rotate([90, 0, 0])
  .translate(upperCenter);

const guitarWaist = sdf.roundedCylinder(waistR, boutH * 1.02, boutRound * 0.5)
  .rotate([90, 0, 0])
  .translate([wX, wY, wZ]);

// Three-section smooth-union through the waist with a SMALL blend — preserves
// the hourglass pinch (a large blend melts the waist into one oval = paddle)
// while staying one shallow plate (no topological tunnel → genus ≤ 3).
const guitarBody = lowerBout
  .smoothUnion(guitarWaist, r.head * 0.20)
  .smoothUnion(upperBout, r.head * 0.20);

// ---- Guitar neck ----
// Start: near the top-left edge of the upper bout.
const neckStartX = upperCenter[0] + r.head * 0.25;
const neckStartY = upperCenter[1];
const neckStartZ = upperCenter[2] + bUR * 0.55;

// End: gL.point — the fretting grip CUP (inside the curled fingers).
// This is the critical fix: neck ends at the grip cup, NOT j.handL (the hand
// centre), so the neck seats in the finger curl rather than passing through
// the middle of the palm.
const neckStart = [neckStartX, neckStartY, neckStartZ];
const neckEnd   = [gL.point[0], gL.point[1], gL.point[2]];

const neckR = r.hand * 0.28;   // slim neck fits in the curl
const neckCaps = sdf.capsule(neckStart, neckEnd, neckR);

// Headstock: extends beyond gL.point along the neck axis.
const nDir = [
  neckEnd[0] - neckStart[0],
  neckEnd[1] - neckStart[1],
  neckEnd[2] - neckStart[2],
];
const nLen = Math.hypot(...nDir);
const nN   = nDir.map(v => v / nLen);
const hsLen = r.head * 0.50;
const hsEnd = [
  neckEnd[0] + nN[0] * hsLen,
  neckEnd[1] + nN[1] * hsLen,
  neckEnd[2] + nN[2] * hsLen,
];
const headstock = sdf.capsule(neckEnd, hsEnd, r.hand * 0.42);

// ---- Assemble guitar ----
const guitar = guitarBody
  .smoothUnion(neckCaps, r.hand * 0.32)
  .smoothUnion(headstock, r.hand * 0.36)
  .label('guitar');

// 8. Union + build.
return sdf.union(skin, eyes, mouthParts, tee, jeans, hair, guitar, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
