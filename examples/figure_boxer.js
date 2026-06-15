// Boxer's Guard — defensive guard stance, fists raised by the chin.
//
// Showcases:
//   - bare torso anatomy: F.nipples (areola label) + F.torso({navel:true})
//   - broad nose (type:'broad') + square jaw face
//   - gaze: 'middle' / lids:'upper' for intense forward look
//   - fists-up guard pose (arms raiseFwd + bend so gloves rise by chin)
//   - boxing glove caps (sdf.sphere over each fist, label 'gloves')
//   - trunks via F.clothing.pants({length:'briefs'})
//   - slight crouch (legs bend 20), chin tuck (head.pitch 8), spine lean fwd
//
// Paint regions: skin, areola, eyes, iris, pupil, lids, gloves, trunks, hair, base

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — average build, adult proportions, boxer's guard.
//    Arms raiseFwd ~50 swings them forward (toward camera); raiseSide ~25 keeps
//    them close to the body; bend ~130 brings fists up by the chin.
//    Slight crouch: legs bend 20, raiseSide 12. Spine lean forward for guard.
const rig = F.rig({
  height: 54,
  headsTall: 7.5,
  build: 'average',
  sex: 'male',
  muscle: 0.65,
  pose: {
    arms: { raiseSide: 25, raiseFwd: 50, bend: 130, twist: 60 },
    legs: { raiseSide: 12, bend: 20 },
    head: { pitch: 8, yaw: 0 },
    spine: { lean: 12 },
  },
});
const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — broad nose, square jaw, intense forward gaze, chin tucked.
const head = F.head(rig, { faceShape: 'square', jaw: 1.15, chin: 0.95, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.14, width: 1.15, flare: 0.9 },
  mouth: { style: 'smile', expression: 'slightFrown', width: r.head * 0.44 },
  ears: { size: r.head * 0.24 },
  brows: { thickness: 1.25, lift: 0.0 },
});

// Paintable eyes — intense forward gaze, upper lids tight
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.16,
  lids: 'upper',
  gaze: 'middle',
});

// 3. BARE SKIN — navel and areolae for bare-chest anatomy.
//    nipples is a TOP-LEVEL part (self-labels 'areola'); do NOT put in weld.
const nipples = F.nipples(rig);

const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. BOXING GLOVES — a rounded sphere cap over each fist, welded into the hands.
//    The fist knuckles protrude into the glove; a union at the hand joint fuses them.
//    Glove radius slightly larger than the fist for a puffy glove look.
const gloveR = r.hand * 1.35;

// Place gloves at the wrist joints (where fists are positioned by the rig)
// Using rig.grip points for accurate hand position
const gloveL = sdf.sphere(gloveR).translate(rig.grip.L.point).label('gloves');
const gloveR_ = sdf.sphere(gloveR).translate(rig.grip.R.point).label('gloves');
const gloves = sdf.union(gloveL, gloveR_).label('gloves');

// 5. TRUNKS — boxing trunks (briefs length)
const trunks = F.clothing.pants(rig, {
  length: 'briefs',
  rise: 'mid',
  leg: 'slim',
  thickness: r.upperLeg * 0.16,
}).label('trunks');

// 6. HAIR — short/shaved crop
const hair = F.hair(rig, { style: 'short', volume: 0.6 }).label('hair');

// 7. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.27 }).label('base');

// 8. Hard-union all labelled regions and build.
//    faceDetail + handDetail for smooth features and fist knuckles.
return sdf.union(skin, eyes, nipples, gloves, trunks, hair, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
