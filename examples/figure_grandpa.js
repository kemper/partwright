// Grandfather with Cane — elderly male figure, slight forward stoop,
// right hand gripping a cane that reaches the base.
// Showcases: age:74, sex:'male', weight:0.45 (new anthropometric axes on F.rig).
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — elderly male, slightly stooped.
// age:74 shifts torso girth to elderly proportions (wider belly, narrower shoulders).
// sex:'male' widens shoulders, narrows hips — key anthropometric contrast.
// weight:0.45 = lean elderly man.
// spine.lean:14 = perceptible forward stoop.
const rig = F.rig({
  height: 44,
  headsTall: 7,
  sex: 'male',
  age: 74,
  build: 'slim',
  weight: 0.45,
  pose: {
    // Right arm: hanging down near the hip with a slight forward lean from the stoop.
    // Keep bend small so the forearm runs close to vertical when accounting for lean.
    armR: { raiseSide: 4, raiseFwd: 0, bend: 5, twist: 0 },
    // Left arm: relaxed, slightly away from body
    armL: { raiseSide: 14, raiseFwd: 8, bend: 20 },
    // Natural standing stance
    legL: { raiseSide: 7 },
    legR: { raiseSide: 7 },
    // Head: slight downward gaze
    head: { yaw: 4, pitch: -5, roll: -2 },  // lift the face so it reads (counters the stoop)
    // Forward stoop
    spine: { lean: 9 },  // a gentle elderly stoop (eased so the figure still reads upright)
  },
});
const r = rig.r;

// Known from pose probe (height 44, headsTall 7, sex male, age 74, weight 0.45):
//   handR:   [-4.9, 0.11, 20.54]
//   grip.R.point: [-4.9, -0.81, 20.4]
//   grip.R.gripAxis: [-1, -0.02, 0.07]  ← nearly sideways; DON'T use holdAt here.
// The cane must be a VERTICAL shaft (world-Z axis) positioned just outside
// the right hand (-X side, offset slightly further right: X ≈ -6.0).
const handR = rig.joints.handR;
const gripR = rig.grip.R;
const caneX = handR[0] - r.hand * 0.5;   // slightly more to the right than the hand
const caneY = handR[1] - r.hand * 0.2;   // slightly forward for visual clarity

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose:  { tipRadius: r.head * 0.10 },
  mouth: { smirk: -0.08 },
  ears:  { size: r.head * 0.24 },
  brows: { lift: 0.3 },
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.13 });

// 3. SKIN — right fist grips the cane
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CARDIGAN — long-sleeved top
const cardigan = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.opts.height * 0.28,
  thickness: r.chestX * 0.13,
}).label('cardigan');

// 5. TROUSERS
const trousers = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
}).label('trousers');

// 6. HAIR — bald for elderly
const hair = F.hair(rig, { style: 'bald' }).label('hair');

// 7. BASE — wide enough to support the stance + cane footprint
const baseThick = rig.opts.height * 0.04;
const base = F.base(rig, {
  radius: rig.opts.height * 0.30,
  thickness: baseThick,
}).label('base');

// 8. CANE — vertical (world-Z) shaft, centered at [caneX, caneY].
// A cane hangs vertically regardless of the spine/arm tilt — visually correct.
// The shaft runs from -1 (embedded in base) up to the handle height.
const caneR   = r.hand * 0.22;
const handleR = r.hand * 0.40;

// Handle height: just above the grip point
const handleZ = handR[2] + r.hand * 0.3;
const caneBotPt  = [caneX, caneY, -1.0];        // into the base for solid overlap
const caneTopPt  = [caneX, caneY, handleZ];
const shaft = sdf.capsule(caneBotPt, caneTopPt, caneR);
const handle = sdf.sphere(handleR).translate([caneX, caneY, handleZ]);
const caneGeom = shaft.smoothUnion(handle, handleR * 0.55);

// Bridge: fat capsule from the grip cup to the nearest cane-shaft point.
// The cane shaft point closest to the grip is at [caneX, caneY, gripR.point[2]].
const caneNearGrip = [caneX, caneY, gripR.point[2]];
const bridge = sdf.capsule(gripR.point, caneNearGrip, r.hand * 0.55);

const cane = caneGeom.smoothUnion(bridge, r.hand * 0.45).label('cane');

// 9. Hard-union and build
return sdf.union(skin, eyes, cardigan, trousers, hair, cane, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
