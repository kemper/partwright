// Crawling Baby — chubby infant on hands and knees, head lifted to look forward.
// Showcases: age:1, headsTall:3.6 (big round baby head), weight:0.55 (chubby),
// all-fours crawling pose (arms + legs folded down), navel, big wide eyes with gaze:'up',
// tiny sculpted toes, diaper via briefs.
//
// Paint regions: skin, diaper, hair, base
// Eyes self-label: eyes, iris, pupil

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — baby proportions: age:1, headsTall:3.6, height:30, weight:0.55 chubby
// All-fours crawling pose:
//   - spine.lean:65 tilts the whole torso forward (leaning well forward)
//   - arms raiseFwd:75 swing arms forward-down; bend:8 keeps forearms close to straight
//   - legs raiseFwd:75 swing thighs forward; bend:100 folds shins back (knees on floor)
//   - head.pitch:-55 lifts head up strongly so the face reads clearly
const rig = F.rig({
  height: 30,
  headsTall: 3.6,
  age: 1,
  build: 'average',
  weight: 0.55,
  pose: {
    // Arms swing forward-down to reach the ground; raiseSide spreads a bit for stability
    arms: { raiseSide: 14, raiseFwd: 75, bend: 8 },
    // Legs: thighs pitched forward, shins folded back — kneeling on all fours
    legs: { raiseSide: 16, raiseFwd: 75, bend: 100 },
    // Torso pitched well forward — baby horizontal crawling posture
    spine: { lean: 65 },
    // Head lifted strongly to face forward (negative pitch = look up/forward)
    head: { pitch: -55, yaw: 0 },
  },
});
const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — big round baby face: wide eyes, button nose, happy smile
const head = F.head(rig, { faceShape: 'round', cheek: 1.4 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.08, nostrils: false },
  mouth: { style: 'smile', expression: 'bigSmile', width: r.head * 0.38 },
  ears: { size: r.head * 0.25 },
  brows: { thickness: 0.8, lift: 0.2 },
});

// Wide eyes with upward gaze — baby looking forward and up.
// Extra radius and forward nudge so the domes protrude clearly past the very
// full cheeks (cheek:1.4) of this chubby baby face.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.27,
  gaze: 'up',
  lids: { upper: 0.15, lower: 0.05 },
}).translate(rig.dir.headForward.map(v => v * r.head * 0.07));

// 3. SKIN — weld body; navel on bare belly
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
], { k: r.lowerArm * 1.4 }).label('skin');

// 4. DIAPER — briefs style, high-rise to cover the belly-button area
const diaper = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
  thickness: r.upperLeg * 0.22,
}).label('diaper');

// 5. HAIR — wispy baby hair (short, low volume)
const hair = F.hair(rig, {
  style: 'short',
  volume: 0.6,
}).label('hair');

// 6. BASE — wide flat disc; the baby is on all fours so the base
// needs to cover both hand and knee contact points, plus the head which
// is lifted upward (head doesn't touch the base but body does).
// Extra-wide base ensures all contact points are welded solidly.
const base = F.base(rig, {
  radius: rig.opts.height * 0.62,
  thickness: rig.opts.height * 0.07,
}).label('base');

// 7. Hard-union all labelled regions and build.
// faceDetail for smooth round baby face, handDetail for open palms, footDetail for tiny toes.
return sdf.union(skin, eyes, diaper, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
