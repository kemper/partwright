// Knitting Granny — sweet elderly woman seated on a stool, knitting in her lap.
// Showcases: age:72 (elderly proportions), bun hairstyle, natural lips with warm smile,
// weight:0.65 (soft fullness), round faceShape, seated pose with stool.
// Hands together in lap working a tiny knitting project; two needles + yarn ball welded.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — elderly woman, seated on stool.
// legs: raiseFwd:88, bend:90 = thighs near horizontal, shins drop down.
// arms: brought forward and inward so open hands meet in the lap.
// age:72 + weight:0.65 + sex:'female' = soft, full older woman proportions.
const rig = F.rig({
  height: 54,
  headsTall: 6.2,
  sex: 'female',
  age: 72,
  build: 'average',
  weight: 0.65,
  pose: {
    legs: { raiseFwd: 88, bend: 90, raiseSide: 10 },
    // Arms brought forward and inward, bent at elbow so hands meet at lap.
    armL: { raiseSide: 8, raiseFwd: 32, bend: 75 },
    armR: { raiseSide: 8, raiseFwd: 32, bend: 75 },
    head: { pitch: 10, yaw: -5 },  // gently looking down at knitting
    spine: { lean: 8 },  // slight forward lean while working
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — round face, warm elderly smile, soft features
const head = F.head(rig, { faceShape: 'round', cheek: 1.3, jaw: 0.85 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.10, projection: 0.75 },
  mouth: {
    style: 'lips',
    lipShape: 'natural',
    expression: 'smile',
    fullness: 1.0,
    width: r.head * 0.38,
  },
  ears: { size: r.head * 0.23 },
  brows: { thickness: 0.9, lift: 0.2 },
});
// Nudge eyes forward along headForward so a round/heart/cheeky face does not
// swallow the domes (else eyes/iris/pupil/lids paint to 0 triangles).
const hf = rig.dir.headForward, eyePush = r.head * 0.13;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.15,
  lids: 'almond',
  gaze: 'down',
})
  .translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// 3. SKIN — weld body masses; relaxed hands for knitting
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: r.lowerArm * 1.2 }).label('skin');

// 4. CLOTHING — long top (skirt-length) covering the seated thighs
const cardigan = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: j.hips[2] - r.hipsY * 0.8,   // hem reaches below pelvis, covers thighs
  thickness: r.chestX * 0.14,
}).label('cardigan');

// 5. HAIR — grey bun
const hair = F.hair(rig, {
  style: 'bun',
  volume: 1.1,
}).label('hair');

// 6. STOOL — short cylinder stool the granny sits on.
// With legs raiseFwd:88, bend:90 the pelvis rises. j.hips is the seat point.
// The stool seat top must be solidly under the pelvis center.
const seatTopZ = j.hips[2] - r.hipsY * 0.85;
const stoolH   = seatTopZ + 0.5;  // slightly into the body for solid boolean overlap
const stoolR   = r.hipsX * 1.55;  // wider than hips

// We build the stool as a simple rounded box to avoid the cylinder's inverted-cone taper.
// Stool body: a squat box standing from z=0 up to the hip height.
const stoolBody = sdf.roundedBox([stoolR * 2.0, stoolR * 1.6, stoolH], r.foot * 0.3)
  .translate([0, j.hips[1], stoolH / 2]);

// Stool legs — four posts reaching to ground
const stoolLegR = stoolR * 0.13;
const stoolOffX = stoolR * 0.65;
const stoolOffY = stoolR * 0.52;
const stoolCy   = j.hips[1];

const mkLeg = (dx, dy) => sdf.capsule(
  [dx, stoolCy + dy, 0.5],
  [dx, stoolCy + dy, stoolH * 0.92],
  stoolLegR
);
const stoolLegs = sdf.union(
  mkLeg( stoolOffX,  stoolOffY),
  mkLeg( stoolOffX, -stoolOffY),
  mkLeg(-stoolOffX,  stoolOffY),
  mkLeg(-stoolOffX, -stoolOffY),
);
const stool = stoolBody.smoothUnion(stoolLegs, stoolLegR).label('stool');

// 7. KNITTING PROJECT — two thin needle capsules + a small yarn ball in the lap.
// Key insight: we must bridge the knitting INTO the hands with fat capsules
// so it's one component. The lap center is between the hand joints.
const lapX = (j.handL[0] + j.handR[0]) / 2;
const lapY = (j.handL[1] + j.handR[1]) / 2;
const lapZ = (j.handL[2] + j.handR[2]) / 2;

// Needle radius and length
const needleR = r.hand * 0.09;
const needleL = r.head * 1.3;

// Needle 1: angled diagonally across the lap
const needle1 = sdf.capsule(
  [lapX - needleL * 0.48, lapY + needleL * 0.15, lapZ + r.hand * 0.2],
  [lapX + needleL * 0.48, lapY - needleL * 0.15, lapZ + r.hand * 0.9],
  needleR
);
// Needle 2: crosses needle1 at opposite angle
const needle2 = sdf.capsule(
  [lapX - needleL * 0.48, lapY - needleL * 0.15, lapZ + r.hand * 0.9],
  [lapX + needleL * 0.48, lapY + needleL * 0.15, lapZ + r.hand * 0.2],
  needleR
);
const needles = needle1.union(needle2).label('needles');

// Yarn ball: welded to the needle crossing AND to the hand joints via fat connector
const yarnR = r.hand * 0.72;
// Position yarn between the hands, slightly in front
const yarnCx = lapX + r.hand * 0.3;
const yarnCy = lapY - r.hand * 0.4;
const yarnCz = lapZ - yarnR * 0.4;
const yarnSphere = sdf.sphere(yarnR).translate([yarnCx, yarnCy, yarnCz]);
// Bridge connector: fat capsule from yarn center to mid-needle crossing, ensuring overlap
const yarnBridge = sdf.capsule(
  [yarnCx, yarnCy, yarnCz],
  [lapX, lapY, lapZ + r.hand * 0.5],
  r.hand * 0.45
);
// And bridge the yarn+bridge to each hand grip point for certain one-piece weld
const bridgeToHandL = sdf.capsule(
  [lapX, lapY, lapZ + r.hand * 0.5],
  rig.grip.L.point,
  r.hand * 0.5
);
const bridgeToHandR = sdf.capsule(
  [lapX, lapY, lapZ + r.hand * 0.5],
  rig.grip.R.point,
  r.hand * 0.5
);
// The yarn assembly (sphere + bridge) labeled together
const yarn = yarnSphere
  .smoothUnion(yarnBridge, r.hand * 0.35)
  .smoothUnion(bridgeToHandL, r.hand * 0.3)
  .smoothUnion(bridgeToHandR, r.hand * 0.3)
  .label('yarn');

// 8. BASE — covers the stool footprint + granny's feet (auto-sizes to pose)
const base = F.base(rig, {
  radius: rig.opts.height * 0.34,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 9. Hard-union all regions and build.
// edgeLength:0.65 to stay under the 200k triangle budget.
return sdf.union(skin, eyes, cardigan, hair, stool, needles, yarn, base)
  .build({ edgeLength: 0.71, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
