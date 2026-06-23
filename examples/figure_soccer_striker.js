// Soccer Striker — a striker caught mid-kick on the follow-through: the right
// leg is swung forward-and-up striking the ball, the planted left leg is bent,
// the arms fly out for balance, and the gaze drops to the ball. ~7.5 heads
// tall, average male build with athletic tone. The ball welds onto the striking
// foot so the whole figure is one printable component.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — kick follow-through.
//    Right leg: raiseFwd 65 swings it forward-and-up to strike, slight bend.
//    Left leg: planted, slightly bent (raiseFwd 5, bend 20) — the support leg.
//    Arms out for balance: armL forward-out, armR back-out (a counter-rotation).
//    Slight forward torso lean; head pitched down to watch the ball.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  muscle: 0.5,
  weight: 0.35,
  pose: {
    // Striking leg (right): swung forward and up, a touch of bend.
    legR: { raiseFwd: 65, bend: 14 },
    // Planted leg (left): supports the body, slightly bent.
    legL: { raiseFwd: 5, bend: 20, raiseSide: 6 },
    // Arms out for balance — opposite swings.
    armL: { raiseSide: 42, raiseFwd: 30, bend: 24 },
    armR: { raiseSide: 38, raiseFwd: -34, bend: 26 },
    // Lean into the kick; head down at the ball.
    spine: { lean: 10 },
    head: { pitch: 20 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — oval face, straight nose, eyes down at the ball, set mouth.
const mouthOpts = { style: 'lips', lipShape: 'flat', width: r.head * 0.46 };
const head = F.head(rig, { faceShape: 'oval' });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight' },
  mouth: false,
  ears:  true,
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper', gaze: 'down' });
const lips = F.face.mouthAccents(rig, mouthOpts);   // painted 'lips'

// 3. SKIN — open hands (relaxed/balancing, not gripping).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SOCCER BALL — a sphere at the striking (right) foot. Placed on the sole
//    frame so it sits right at the contact point, then welded via the top-level
//    union (the ball overlaps the foot, keeping the figure one component).
//    The ball must INTERSECT the foot by a solid margin — a marginal (barely
//    touching) overlap connects in the Node SSR build but SPLITS into its own
//    component in the browser's manifold build. So keep the off-toe nudge small
//    (the ball centre stays within ~ballR of the foot) and grow the radius.
const ballR = r.foot * 2.0;
const ballC = rig.sole.R.point;
// Seat the ball center DEEP inside BOTH the foot mass and the cleat shell so the
// weld neck is thick and survives the browser manifold build. A marginal (center
// sitting on the foot surface) overlap connects in the Node SSR build but SPLITS
// into its own component in the browser — empirically footSdf/cleatSdf at the
// ball center must both be solidly negative (~ -0.6), not ~0. Keep only a small
// off-toe nudge and lift so the ball still reads as struck forward at strike
// height, while the center stays buried in the foot/cleat.
const heading = rig.sole.R.heading;
const ballCenter = [
  ballC[0] + heading[0] * ballR * 0.12,
  ballC[1] + heading[1] * ballR * 0.12,
  ballC[2] + ballR * 0.30,   // lift toward the foot's strike height (ball not on the ground)
];
const ball = sdf.sphere(ballR).translate(ballCenter).label('ball');

// 5. JERSEY — short-sleeve striker's shirt.
const jersey = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestY * 0.2,
}).label('jersey');

// 6. SHORTS — match-shorts (briefs = seat + hip coverage), so the quads show.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 7. HAIR — short fade. NOTE: a relief 'texture' (e.g. 'coils') must NOT be used
//    at this figure's coarse edgeLength (0.68): the displaced relief aliases into
//    disconnected islands in the browser manifold build (skin+coily-hair alone
//    bakes as 5 components / negative genus), even though the Node SSR build fuses
//    them. The figure docs call for edgeLength ≤ ~0.4 for hair texture — too fine
//    for the ~200k tri budget here — so the short fade stays smooth.
const hair = F.hair(rig, { style: 'short', hairline: 'mid' }).label('hair');

// 8. CLEATS — football boots, flat on the ground (own 'shoes' + 'sole' regions).
const cleats = F.clothing.shoes(rig, { label: 'shoes' });

// 9. BASE — auto-rises to meet the planted (left) foot.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 10. Hard-union all labelled regions and build.
return sdf.union(skin, eyes, lips, ball, jersey, shorts, hair, cleats, base)
  .build({
    edgeLength: 0.68,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
