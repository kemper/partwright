// Soccer Striker — female player mid-kick, dominant leg swung high forward,
// arms thrown out for balance, gaze looking down at the ball.
// Showcases: gaze:'down', extreme legR raiseFwd (kick mechanics), balancing
// arms spread wide, F.clothing.shoes (cleats), and a welded ball at the foot.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — athletic female, mid-kick pose.
//    Right leg swings high forward (the kicking leg); left leg planted and
//    slightly bent for balance. Arms thrown wide for balance.
const rig = F.rig({
  height: 54,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  muscle: 0.45,
  weight: 0.40,
  pose: {
    // Right (kicking) leg: swung far forward, mostly straight for a power kick.
    legR: { raiseFwd: 72, bend: 14, raiseSide: 4 },
    // Left (standing) leg: planted, slight bend at the knee.
    legL: { raiseSide: 5, bend: 18, raiseFwd: -4 },
    // Arms thrown wide for dynamic balance.
    armL: { raiseSide: 62, raiseFwd: 10, bend: 18 },
    armR: { raiseSide: 38, raiseFwd: -18, bend: 24 },
    // Head looking down at the ball — gaze:'down' via head pitch.
    head: { pitch: 22, yaw: -6 },
    // Slight forward lean into the kick.
    spine: { lean: 14, turn: -8 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — focused downward gaze, determined expression.
const head = F.head(rig, { faceShape: 'oval', cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.09, length: r.head * 0.22 },
  mouth: { style: 'smile', expression: 'neutral', width: r.head * 0.38 },
  ears: { size: r.head * 0.21 },
  brows: { lift: 0.1 },
});
// Eyes looking down toward the ball — gaze:'down'.
const eyes = F.face.eyes(rig, { radius: r.head * 0.155, lids: 'almond', gaze: 'down' });

// 3. SKIN — relaxed hands (arms for balance, not gripping).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. JERSEY — short-sleeve soccer top.
const jersey = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: j.hips[2] + r.hipsY * 0.6,
  thickness: r.chestY * 0.19,
}).label('jersey');

// 5. SHORTS — mid-rise soccer shorts.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'full',
  cuffZ: j.upperLegL[2] - (j.upperLegL[2] - j.lowerLegL[2]) * 0.35,
  thickness: r.upperLeg * 0.17,
}).label('shorts');

// 6. CLEATS — soccer shoes with a welt sole. Owns 'cleats' + 'sole' regions.
const cleats = F.clothing.shoes(rig, {
  label: 'cleats',
  sole: { style: 'welt', lip: r.foot * 0.08, thickness: r.foot * 0.36 },
});

// 7. HAIR — ponytail style for an active look.
const hair = F.hair(rig, { style: 'ponytail', length: 'long', volume: 0.95 }).label('hair');

// 8. SOCCER BALL — welded to the base at ground level, near the kicking foot.
//    The ball must overlap with the base by 0.5+ units to fuse into one component.
//    We embed the ball so its bottom sits 0.8 units BELOW the base top surface,
//    guaranteeing a solid overlap/weld with the base disc.
const ballR = r.head * 0.65;
// Place ball in front of the standing (left) foot and slightly to the right.
const ballX = j.footL[0] - ballR * 0.4;
const ballY = j.footL[1] - ballR * 1.2;
// Embed ball 0.8 units below z=0 so the sphere definitely overlaps the base.
const ballZ = ballR - 0.9;
const ball = sdf.sphere(ballR).translate([ballX, ballY, ballZ]).label('ball');

// 9. BASE — disc; the kicking pose has a wide footprint, so size up slightly.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 10. Build — face and hand detail for crisp features.
return sdf.union(skin, eyes, jersey, shorts, cleats, hair, ball, base)
  .build({ edgeLength: 0.56, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
