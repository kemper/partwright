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
    // Left arm: fretting hand raised in front of the chest, oriented so its GRIP
    // AXIS (rig.grip.L.gripAxis — the line a held bar lies along) is parallel to
    // the diagonal neck. Found by sweeping the pose for max grip↔neck alignment
    // (|dot| ≈ 0.996): the neck then lies IN the curled fingers instead of
    // stabbing through the palm perpendicular. twist=−30 rolls the grip so the
    // bar runs up the neck, not across it; the hand lands ≈ [3.8, −6.4, 53.4].
    armL: { raiseSide: 55, raiseFwd: 40, bend: 130, twist: -30 },
    // Right arm: strumming hand drops DOWN over the lower guitar body.
    // Low raiseSide and raiseFwd=20 hang the arm at waist height; bend=0 keeps it
    // straight so the hand hovers just in front of the lower bout.
    armR: { raiseSide: 0, raiseFwd: 20, bend: 0, twist: 0 },
    // Wide rock stance
    legL: { raiseSide: 26 },
    legR: { raiseSide: 26 },
    // Head up slightly — open mouth visible from front (not hidden by jaw)
    head: { yaw: -8, roll: 4, pitch: -5 },
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
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'hooded' });
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
  thickness: r.upperLeg * 0.22,
}).label('jeans');

// 5. HAIR — bangs (fringe).
const hair = F.hair(rig, { style: 'spiked' }).label('hair');

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

// Lower bout: X at the strumming cup. Pull the body BACK so its front face sits
// just behind the strumming hand's CENTRE (j.handR) — that keeps the palm and
// fingers in FRONT of the surface (resting on it, not poking through) while the
// back of the hand overlaps enough (~0.5 units) to fuse into one piece. Keying
// off handR, not gR.point, is what guarantees the hand clears the front face.
const lbX = gR.point[0];
const lbY = j.handR[1] + boutH * 0.5 + r.head * 0.10;
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

// neck = the prop spanning the upper bout to the fretting grip CUP (gL.point,
// inside the curled fingers — NOT j.handL, so the neck seats in the finger curl
// instead of impaling the palm). spanGrips gives the neck's own axis + length;
// the headstock continues collinearly past the fret cup with no kink — no
// hand-rolled vector math.
const neck = F.spanGrips(neckStart, gL.point);
const neckEnd = neck.b;

const neckR = r.hand * 0.28;   // slim neck fits in the curl
const neckCaps = sdf.capsule(neck.a, neck.b, neckR);

// Headstock: extends beyond the fret cup along the same neck axis.
const hsLen = r.head * 0.50;
const hsEnd = [
  neckEnd[0] + neck.axis[0] * hsLen,
  neckEnd[1] + neck.axis[1] * hsLen,
  neckEnd[2] + neck.axis[2] * hsLen,
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
