// Grand Jeté Dancer — a female dancer caught mid-air in a grand jeté: legs split
// front-and-back, arms swept open gracefully, pointed (pointe) feet, head up.
// Airborne — F.base auto-rises to meet the lowest (trailing) foot; the split is
// kept moderate so the trailing toe can connect to the base and the figure stays
// one component. Slim, ~8 heads tall, elegant art-toy aesthetic.
//
// Paint regions: skin, eyes, iris, pupil, lids, hair, leotard, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tall, slim, female dancer. The split: left leg swept forward
// (raiseFwd 70, slight bend), right leg swept back (raiseFwd -70, slight bend).
// A moderate split keeps the trailing toe close enough to the base to weld.
// Arms swept open: right arm forward-up (raiseSide 70, raiseFwd 20), left arm
// out to the side (raiseSide 95). Head up (pitch -8).
const rig = F.rig({
  height: 64,
  headsTall: 8,
  sex: 'female',
  build: 'slim',
  muscle: 0.35,
  weight: 0.28,
  pose: {
    // Split legs front/back — moderate so the trailing toe reaches the base.
    legL: { raiseFwd: 70, bend: 10 },
    legR: { raiseFwd: -70, bend: 15 },
    // Arms swept open gracefully.
    armR: { raiseSide: 70, raiseFwd: 20 },
    armL: { raiseSide: 95 },
    // Head up.
    head: { pitch: -8 },
  },
});

// 2. HEAD + FACE — heart face shape, pointed nose, ears on. Eyes off here (they
// get their own paint label at the top level). Mouth is the additive lips ridge
// below (gentle smile), so assemble gets mouth: false.
const head = F.head(rig, { faceShape: 'heart' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'pointed' },
  mouth: false,
  ears: true,
  brows: {},
});

// 3. SKIN — weld the body. Barefoot with smooth pointe (toes: false).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: false }),
  face,
]).label('skin');

// 3b. EYES — hard-unioned at top level; iris style self-labels eyes/iris/pupil,
// plus 'lids' for the almond lids. Gaze forward (default).
const eyes = F.face.eyes(rig, { lids: 'almond', gaze: 'middle' });

// 3c. LIPS — additive natural lips with a gentle smile ('lips' label).
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
});

// 4. LEOTARD — sleeveless top + high-rise briefs, unioned and labeled as one piece.
const bodice = F.clothing.top(rig, {
  sleeve: 'none',
  thickness: rig.r.chestY * 0.16,
});
const briefs = F.clothing.pants(rig, {
  rise: 'high',
  length: 'briefs',
  thickness: rig.r.upperLeg * 0.22,
});
const leotard = bodice.union(briefs).label('leotard');

// 5. HAIR — ponytail streaming back.
const hair = F.hair(rig, { style: 'ponytail' }).label('hair');

// 6. BASE — auto-rises to meet the lowest (trailing) foot, keeping the figure
// one component while it reads as airborne above the disc.
// Auto-sized base — widens to cover the wide front/back split and rises to meet
// the lowest (trailing) foot, keeping the whole welded figure one component.
const base = F.base(rig).label('base');

// 7. Hard-union all labeled regions and build. faceDetail meshes the face finely;
// handDetail resolves the sculpted open hands.
return sdf.union(skin, eyes, lips, leotard, hair, base)
  .build({ edgeLength: 0.7, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
