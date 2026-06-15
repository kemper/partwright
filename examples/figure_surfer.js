// Hang Loose Surfer — riding stance on a surfboard, knees bent, arms out for
// balance, box braids, almond sun-squint lids. Surfboard spans both soles and
// acts as the base so the figure prints as one solid piece.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — wide bent riding stance. F.ground 'drop' ensures both feet sit on
//    the board's top surface regardless of the bent-knee pose offsets.
const rig = F.ground(F.rig({
  height: 60,
  headsTall: 6.5,
  build: 'average',
  sex: 'neutral',
  pose: {
    // Wide bent stance — classic surfing crouch; bend 40 = clear knee bend
    legs:  { raiseSide: 16, bend: 40 },
    legR:  { raiseFwd: 14 },    // right foot forward (front foot on board)
    legL:  { raiseFwd: -8 },    // left foot back
    // Arms wide for balance
    arms:  { raiseSide: 55, bend: 15 },
    armL:  { raiseFwd: 18 },
    armR:  { raiseFwd: -6, raiseSide: 58 },
    head:  { yaw: 10, pitch: 4 },
    spine: { lean: 10, side: -3 },
  },
}), { mode: 'drop' });

const j = rig.joints, r = rig.r;
const soleL = rig.sole.L;
const soleR = rig.sole.R;

// 2. SURFBOARD — spans both feet; top surface at the lower groundZ.
const groundZ    = Math.min(soleL.groundZ, soleR.groundZ);
const midX       = (soleL.point[0] + soleR.point[0]) / 2;
const midY       = (soleL.point[1] + soleR.point[1]) / 2;
const boardLen   = r.foot * 8.5;   // nose-to-tail (spans well past both feet)
const boardWide  = r.foot * 2.8;   // rail-to-rail
const boardThick = r.foot * 0.50;  // deck thickness
const boardCz    = groundZ - boardThick * 0.5;  // board centre Z

// Main deck — rounded box, slightly tapered nose-to-tail
const boardDeck = sdf.roundedBox([boardWide, boardLen, boardThick], r.foot * 0.20)
  .taper(-0.05, 'y')
  .translate([midX, midY, boardCz]);

// Fin (skeg) — single centre fin hanging below the tail
const finH   = r.foot * 0.75;
const finThk = r.foot * 0.16;
const finY   = midY + boardLen * 0.28;
const finTop = [midX, finY, boardCz - boardThick * 0.5];
const finBot = [midX, finY - r.foot * 0.20, boardCz - boardThick * 0.5 - finH];
const fin    = sdf.capsule(finTop, finBot, finThk);

const board = boardDeck.smoothUnion(fin, finThk * 0.5).label('board');

// 3. HEAD + FACE — sun-squint almond lids, relaxed smile.
const head = F.head(rig, { faceShape: 'oval', cheek: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'broad', flare: 0.7, tipSize: 1.05 },
  mouth: { style: 'smile', expression: 'smile', smirk: 0.12, width: r.head * 0.40 },
  ears:  { size: r.head * 0.22 },
  brows: {},
});
// Almond lids = sun squint; gaze slightly down-right (watching the wave)
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids:   'almond',
  gaze:   { yaw: 10, pitch: -5 },
});

// 4. SKIN — open hands (arms out for balance)
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig),
  F.arms(rig), F.hands(rig, { grip: 'open' }),
  F.legs(rig), F.feet(rig),
  face,
]).label('skin');

// 5. CLOTHES — board shorts (low-rise brief cut = swimwear look)
const shorts = F.clothing.pants(rig, {
  leg:    'slim',
  rise:   'low',
  length: 'briefs',
}).label('shorts');

// Rash guard top (sleeveless) — short hem reads as a fitted vest/singlet
const rashGuard = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ:   j.spine[2] + r.hipsY * 0.06,
}).label('rashguard');

// 6. BOX BRAIDS HAIR — short length keeps strands welded at this edgeLength.
//    Coarser faceDetail (0.10/0.05 head radii) keeps us under the 195k budget.
const hair = F.hair(rig, {
  style:  'boxBraids',
  length: 'short',
  volume: 0.9,
}).label('hair');

// 7. BASE — thin disc; the board is the visual ground but F.base ensures the
//    feet weld into one printed piece across the wide stance.
const base = F.base(rig, { thickness: r.foot * 0.13 }).label('base');

// 8. Hard-union + build.
//    Use scaled-back faceDetail (still 2-3x finer than body grid) to stay
//    under the 195k tri budget. handDetail kept for sculpted fingers.
return sdf.union(skin, eyes, shorts, rashGuard, board, base, hair)
  .build({
    edgeLength: 0.62,
    detail: [
      ...F.faceDetail(rig, { edgeLength: r.head * 0.10, eyeEdgeLength: r.head * 0.05 }),
      ...F.handDetail(rig),
    ],
  });
