// Grand Bow — a performer taking a deep theatrical bow, torso folded far forward,
// one arm swept across the waist, the other flourished out to the side.
// Long hair spills forward with the bow, ears visible.
//
// SHOWCASE: spine.lean:62 deep forward bow, long wavy hair that drapes forward,
// gracious smile, ears visible (hair pulled back in a ponytail with strands free).
//
// Front = −Y, Z up, figure's left = +X, right = −X. ~7 heads tall, slim build.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — deep theatrical bow.
// spine.lean:62 folds the whole upper body far forward at the waist.
// armL swept across the waist (raiseSide low, raiseFwd high → sweeps across front).
// armR flourished out to the side with a slight elbow bend.
// Legs together; left leg slightly back for a graceful asymmetric stance.
// head.pitch:20 (in torso-local terms) keeps the face angled down slightly
// relative to the torso so it reads as looking toward the floor during the bow —
// which is natural for a deep bow. The head faces partially toward the audience.
const rig = F.rig({
  height: 64,
  headsTall: 7,
  build: 'slim',
  sex: 'female',
  pose: {
    // Deep forward bow — upper body folds forward at the waist. Eased from 62 so
    // the head can still lift to make eye contact with the audience (the face must
    // read in the catalog thumbnail, not tuck into the chest).
    spine: { lean: 42 },
    // Left arm: swept gracefully across the waist in a sweeping curtsy gesture
    armL: { raiseSide: 22, raiseFwd: 75, bend: 42 },
    // Right arm: flourished wide to the side with a gentle elbow bend
    armR: { raiseSide: 68, raiseFwd: 22, bend: 24 },
    // Legs together with left slightly back for a graceful stance
    legL: { raiseSide: 5, raiseFwd: -10 },
    legR: { raiseSide: 5, raiseFwd: 4 },
    // Head lifts back UP relative to the leaned torso so the performer makes eye
    // contact with the audience during the bow — keeps the face forward-facing and
    // the eyes exposed (a strong down-pitch buries the eye domes in the head).
    head: { pitch: -28, yaw: 8 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — gracious smile, ears visible, slight brow arch
// face shape: heart — refined and elegant
const head = F.head(rig, { faceShape: 'heart', jaw: 0.95, chin: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.085 },
  mouth: { style: 'lips', lipShape: 'full', expression: 'bigSmile', fullness: 1.2, width: r.head * 0.28 },
  ears: { size: r.head * 0.21 },
  brows: { lift: 0.2, thickness: 0.9 },
});
// Eyes: almond lids, gaze looking slightly down-and-left (toward the stage floor
// during the bow — a natural performer's bow look)
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.145,
  lids: 'almond',
  gaze: 'middle',
});

// 3. SKIN — both hands relaxed (one sweeps, one extends)
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. COSTUME — a tailored dress (short sleeves, long hem)
// Low hem creates a dramatic fanned skirt that reads well when bowing forward.
const dress = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: rig.opts.height * 0.06,
  thickness: r.chestX * 0.12,
}).label('dress');

const shoes = F.clothing.shoes(rig, {
  thickness: r.foot * 0.20,
}).label('shoes');

// 5. HAIR — long ponytail with wavy texture: when the torso bows forward the
// ponytail spills forward naturally (the hair mass follows the head's position).
// Ears are visible because the hair is pulled back from the sides.
const hair = F.hair(rig, {
  style: 'ponytail',
  texture: 'wavy',
  length: 'long',
  volume: 1.1,
}).label('hair');

// 6. BASE — the two feet are fairly close together; standard auto-size is fine
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.046,
}).label('base');

// 7. Union + build
// A deep bow (spine.lean:62) means the default iso view can look like a faceless
// blob — the thumbCamera for the catalog should be set to a front-right elevated
// angle that shows the face and the sweeping arms.
return sdf.union(skin, eyes, dress, shoes, hair, base)
  .build({ edgeLength: 0.58, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
