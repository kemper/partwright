// Archer Drawing a Bow — an archer at full draw: the lead (left) arm extended
// holding a recurve bow, the draw (right) hand pulled back near the cheek, head
// turned to sight down the arrow. Stylized art-toy figurine, ~7.5 heads tall.
// Front = −Y, Z up, figure's left = +X, right = −X.
//
// SHOWCASE: a recurve bow built as an arc of capsules centred at the origin and
// seated in the LEFT hand with F.holdAt(bow, rig.grip.L); an arrow capsule run
// from the right (draw) grip toward the bow centre. Both welded so the figure is
// ONE component. Pose grips read with F.poseProbe before aiming the props.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — lean, lightly-muscled adult female at full draw.
// armL: extended out/forward holding the bow (raiseSide 88, raiseFwd 28,
//   near-straight bend 10) → bow hand far out at the figure's left.
// armR: drawn back to the cheek (raiseSide 78, bend 140) → fist near the face.
// head yaw +18 turns the head toward the bow side (+X) to sight the arrow.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  muscle: 0.45,
  weight: 0.32,
  pose: {
    armL: { raiseSide: 88, raiseFwd: 28, bend: 10 },   // lead arm extended, near-straight
    armR: { raiseSide: 70, bend: 150 },                // draw arm bent back, fist anchored at the cheek
    legL: { raiseSide: 12 },
    legR: { raiseSide: 12 },
    head: { yaw: 18 },                                  // sight down the arrow toward the bow
  },
});
const r = rig.r;

// 2. HEAD + FACE — heart face, straight nose, ears, focused upper lids, gaze to
// the side (toward the bow). Additive natural lips, set (no smile). Small/tall
// head → additive lips, not carved.
const head = F.head(rig, { faceShape: 'heart' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.09 },
  mouth: false,
  ears: { size: r.head * 0.20 },
  brows: {},
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  lids: 'upper',                          // focused, defined upper lid
  gaze: 'left',                           // sight toward the bow (figure's left)
});
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'neutral',                  // set, concentrating
});

// 3. SKIN — both hands as fists (gripping the bow / drawing the string).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. TUNIC — short-sleeved top.
const tunic = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestX * 0.12,
}).label('tunic');

// 5. LEGGINGS — slim leg.
const leggings = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
}).label('leggings');

// 6. BOOTS — own their 'sole' region; don't .label() over them.
const boots = F.clothing.boots(rig, {
  label: 'boots',
  shaftZ: rig.opts.height * 0.28,
});

// 7. HAIR — ponytail.
const hair = F.hair(rig, { style: 'ponytail' }).label('hair');

// 8. BASE — disc under the feet.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 9. RECURVE BOW — built centred at the origin as a vertical arc of capsules
// along local +Z, curving forward (−Y, away from the archer's grip), then HELD
// in the left hand. holdAt aligns the local +Z to the left grip's (downward)
// axis and drops the centre on the grip cup, so the bow stands across the lead
// hand. A small grip-bridge welds it solidly to the fist.
const bowHalf = rig.opts.height * 0.42;      // half the bow length
const limbR   = r.hand * 0.42;               // limb thickness
// belly(t): the bow's forward (−Y) offset along its length, t in 0..1, with the
// RISER (t=0.5, the grip contact) shifted to local y=0 so F.holdAt seats the
// grip point ON the riser (not 8 units forward of it — that gap left the bow a
// floating second component). A cosine bulge forward, tips recurving back (+Y).
const bellyRaw = (t) => {
  const u = t * 2 - 1;                         // -1..1 over the bow
  const bow = Math.cos(u * Math.PI / 2);       // 1 at centre, 0 at tips
  const recurve = Math.max(0, Math.abs(u) - 0.78) * 6.0;  // tips kick back
  return -bow * bowHalf * 0.34 + recurve * bowHalf * 0.10;
};
const bellyOff = bellyRaw(0.5);
const belly = (t) => bellyRaw(t) - bellyOff;   // riser at local y=0
// Arc the limb from short capsules walking z = -bowHalf .. +bowHalf.
const bowSegs = [];
const N = 14;
for (let i = 0; i < N; i++) {
  const t0 = i / N, t1 = (i + 1) / N;
  const z0 = -bowHalf + t0 * 2 * bowHalf;
  const z1 = -bowHalf + t1 * 2 * bowHalf;
  const rr = limbR * (0.55 + 0.45 * Math.cos((t0 * 2 - 1) * Math.PI / 2));
  bowSegs.push(sdf.capsule([0, belly(t0), z0], [0, belly(t1), z1], Math.max(rr, limbR * 0.4)));
}
// thicken the central riser (grip) where the hand holds
const riser = sdf.capsule(
  [0, belly(0.46), -bowHalf * 0.12],
  [0, belly(0.54),  bowHalf * 0.12],
  limbR * 1.25,
);
let bowLocal = bowSegs[0];
for (let i = 1; i < bowSegs.length; i++) bowLocal = bowLocal.smoothUnion(bowSegs[i], limbR * 0.5);
bowLocal = bowLocal.smoothUnion(riser, limbR * 0.6);
// bowstring: a thin straight capsule from tip to tip, behind the belly (+Y of it)
const stringR = limbR * 0.22;
const bowstring = sdf.capsule(
  [0, belly(0) + bowHalf * 0.10, -bowHalf * 0.94],
  [0, belly(1) + bowHalf * 0.10,  bowHalf * 0.94],
  stringR,
);
bowLocal = bowLocal.union(bowstring);

const heldBow = F.holdAt(bowLocal, rig.grip.L);
// weld the bow to the fist so it stays one component. A fat bridge from the hand
// CENTRE through the grip cup to the bow riser, plus a weld ball at the grip,
// guarantees the bow fuses with the fist into one component.
const gripL = rig.grip.L.point;
const handL = rig.joints.handL;
const bowBridge = sdf.capsule(handL, gripL, r.hand * 0.85);
const bowWeld = sdf.sphere(r.hand * 0.95).translate(gripL);
const bow = heldBow
  .smoothUnion(bowBridge, r.hand * 0.5)
  .smoothUnion(bowWeld, r.hand * 0.5)
  .label('bow');

// 10. ARROW — a thin capsule running from the right (draw) grip toward the bow
// centre (the left grip), passing across the body at draw height. Welded into
// the bow/hands so it stays one component.
const drawPt = rig.grip.R.point;
const bowCenter = rig.grip.L.point;
// extend a little past the bow so the arrow tip pokes through the riser
const dir = [
  bowCenter[0] - drawPt[0],
  bowCenter[1] - drawPt[1],
  bowCenter[2] - drawPt[2],
];
const dlen = Math.hypot(dir[0], dir[1], dir[2]);
const u = [dir[0] / dlen, dir[1] / dlen, dir[2] / dlen];
const tip = [
  drawPt[0] + u[0] * (dlen + bowHalf * 0.10),
  drawPt[1] + u[1] * (dlen + bowHalf * 0.10),
  drawPt[2] + u[2] * (dlen + bowHalf * 0.10),
];
// nock a touch behind the draw hand
const nock = [
  drawPt[0] - u[0] * r.hand * 1.2,
  drawPt[1] - u[1] * r.hand * 1.2,
  drawPt[2] - u[2] * r.hand * 1.2,
];
const shaft = sdf.capsule(nock, tip, r.hand * 0.16);
// weld the arrow to BOTH grips so it's one component
const arrowBridgeR = sdf.capsule(rig.joints.handR, drawPt, r.hand * 0.45);
const arrow = shaft
  .smoothUnion(arrowBridgeR, r.hand * 0.35)
  .label('arrow');

// 11. Hard-union all labelled regions and build.
return sdf.union(skin, eyes, lips, tunic, leggings, boots, hair, bow, arrow, base)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
