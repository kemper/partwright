// Jump Shot — male basketball player at the apex of a jump, arms raised high to
// release the ball. Showcases: muscle axis (muscle:0.55), gaze:'up', dynamic
// airborne jump mechanics with one knee tucked up, F.clothing.shoes footwear,
// and a welded basketball cupped near the raised hands.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — athletic male, airborne at the top of a jump shot.
//    Arms raised high and forward to release the ball; right knee tucked up
//    (airborne); left leg extended down (the trailing takeoff leg).
//    raiseFwd ~110 swings arms far forward and up; twist:90 rotates the elbow
//    curl plane upward so forearms extend upward rather than forward.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  muscle: 0.55,
  weight: 0.38,
  pose: {
    // Both arms reaching HIGH overhead in shooting form.
    // raiseSide ~155 brings arms nearly vertical (overhead); twist:90 curls the
    // forearm UPWARD (as in ballet fifth / double-biceps overhead). raiseFwd ~20
    // tilts the arms slightly forward. bend:45 creates the shooting elbow angle.
    armL: { raiseSide: 155, raiseFwd: 20, bend: 45, twist: 90 },
    armR: { raiseSide: 162, raiseFwd: 15, bend: 40, twist: 90 },
    // Right knee tucked up — airborne knee lift.
    legR: { raiseFwd: 42, bend: 76, raiseSide: 6 },
    // Left leg extended down, slight back swing — jump takeoff leg.
    legL: { raiseFwd: -10, raiseSide: 5, bend: 6 },
    // Head looking up toward the basket.
    head: { pitch: -18 },
    // Slight forward spine lean for shooting form.
    spine: { lean: 8 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — focused, looking up.
const head = F.head(rig, { faceShape: 'oval', jaw: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.10, flare: 0.6 },
  mouth: { style: 'smile', expression: 'slightSmile', width: r.head * 0.40 },
  ears: { size: r.head * 0.22 },
  brows: { lift: 0.3 },
});
// Eyes looking up toward the hoop — gaze:'up'.
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper', gaze: 'up' });

// 3. SKIN — open hands for the shot release.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. JERSEY — sleeveless basketball tank (sleeve: 'none').
const jersey = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: j.hips[2] + r.hipsY * 0.4,
  thickness: r.chestY * 0.19,
}).label('jersey');

// 5. SHORTS — mid-rise basketball shorts to mid-thigh.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'full',
  cuffZ: j.upperLegL[2] - (j.upperLegL[2] - j.lowerLegL[2]) * 0.40,
  thickness: r.upperLeg * 0.18,
}).label('shorts');

// 6. BASKETBALL SHOES — owns 'shoes' + 'sole' regions, do NOT add .label().
const shoes = F.clothing.shoes(rig, {
  label: 'shoes',
  sole: { style: 'welt', lip: r.foot * 0.11, thickness: r.foot * 0.40 },
});

// 7. HAIR — short fade with coily texture.
const hair = F.hair(rig, { style: 'short', texture: 'coils', volume: 0.9 }).label('hair');

// 8. BASKETBALL — cupped above the right hand (shooting hand).
//    Ball radius is real-proportions (~0.52× head radius for a size-7 ball).
//    The ball centre sits at the right wrist level + ballR so fingers cup it.
//    Must overlap the hand volume by 0.5+ units to fuse into one component.
const ballR = r.head * 0.52;
// Place ball centered near the right wrist, just above it.
const ballCenter = [
  j.wristR[0],
  j.wristR[1] - ballR * 0.3,
  j.wristR[2] + ballR * 0.8,
];
const ball = sdf.sphere(ballR).translate(ballCenter).label('ball');

// 9. BASE — disc sized for the airborne wide-stance footprint.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 10. Build — face and hand detail for crisp eyes and fingers.
return sdf.union(skin, eyes, jersey, shorts, shoes, hair, ball, base)
  .build({ edgeLength: 0.58, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
