// Surfer — a tanned surfer in a low riding crouch on a surfboard, arms spread
// wide for balance, looking ahead with a relaxed sun-squint grin. Bare chest,
// board shorts, barefoot. The SURFBOARD is the base/stand the figure rides.
//
// The board replaces F.base: it is one long rounded board centred under the
// stance, dropped onto the lower sole's ground plane and welded to BOTH feet so
// the whole thing stays ONE component and rests flat on the ground.
//
// Front = −Y, Z up, figure's left = +X, right = −X.
//
// Paint regions: skin, areola, eyes, iris, pupil, lids, hair, shorts, board
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — average athletic male, 7.5 heads. A LOW WIDE surf crouch: legs spread
//    and bent, one foot forward (surf stance), arms flung out wide for balance,
//    torso a touch forward, head up looking ahead.
const rig = F.ground(F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  muscle: 0.45,
  weight: 0.32,
  pose: {
    // Arms spread wide out to the sides for balance, slight bend, open hands.
    arms: { raiseSide: 80, bend: 12 },
    // LOW surf crouch: a wide stance (raiseSide 24) with the front (-Y) leg
    // lunged forward and the rear leg folded deeper (knee flexion about 80 front /
    // 105 rear after the ground drop below). Staggered fore/aft so both soles sit
    // along the board's long (Y) axis.
    legL: { raiseSide: 24, bend: 38, raiseFwd: 48 },
    legR: { raiseSide: 24, bend: 50, raiseFwd: 20 },
    // Torso leans well forward into the ride; the head pitches back up so the
    // gaze stays forward.
    spine: { lean: 27, turn: 6 },
    head: { pitch: -24, yaw: 6 },
  },
  // 'drop' re-poses each leg (2-bone IK, hips fixed) so BOTH feet land coplanar on
  // one ground plane. The rig's hips stay at standing height, so the crouch is
  // made by dropping the soles to z = 10: both ankles are pulled up toward the
  // hips (knees fold), leaving the hips about 16 above the soles and the crown
  // about 43 above the deck (vs ~55 standing). The flat deck then seats under
  // BOTH feet.
}), { mode: 'drop', z: 10 });
const j = rig.joints,
  r = rig.r;

// 2. HEAD + FACE — square face, straight nose, relaxed grin with a sun-squint.
const mouthOpts = { style: 'lips', lipShape: 'natural', expression: 'slightSmile', width: r.head * 0.5 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight' },
  mouth: false,
  ears: true,
  brows: {},
});

// Paintable eyes — top-level, self-labelled. A sun-squint (both lids partly in)
// with a forward gaze.
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: { upper: 0.35, lower: 0.2 }, gaze: 'middle' });
// Relaxed grin — additive natural lips, so they survive on the small head.
const lips = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — bare chest (navel relief), open balance hands, barefoot with toes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 3b. AREOLAE — flush paintable discs + tiny nipples on the bare chest.
const nipples = F.nipples(rig, { on: skin });

// 4. BOARD SHORTS — slim, knee-length board shorts. cuffZ projected to ~mid-shin
//    so they read as longer surf shorts (not briefs).
const shortsCuffZ = j.lowerLegL[2] + (j.footL[2] - j.lowerLegL[2]) * 0.35;
const shorts = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  cuffZ: shortsCuffZ,
  thickness: r.upperLeg * 0.2,
}).label('shorts');

// 5. HAIR — short, tousled wavy.
const hair = F.hair(rig, { style: 'short', texture: 'wavy' }).label('hair');

// 6. SURFBOARD — the base/stand. One long, narrow surfboard (about 2.6x longer
//    than wide) spanning both feet, welded to BOTH so the figure is ONE
//    component. The deck is FLAT at a height just above the higher sole, so each
//    foot is planted on the top surface and overlaps it ~0.5 (they weld); the
//    hull below narrows to rounded rails.
const soleL = rig.sole.L,
  soleR = rig.sole.R;
const groundZ = Math.min(soleL.groundZ, soleR.groundZ);
const highSole = Math.max(soleL.groundZ, soleR.groundZ);

// Board footprint centred between the two soles (in X/Y), board long axis along
// −Y/+Y (the direction of travel) so the fore/aft surf stance straddles it.
const midX = (soleL.point[0] + soleR.point[0]) * 0.5;
const midY = (soleL.point[1] + soleR.point[1]) * 0.5;

// Size the board off the ACTUAL stance footprint so it spans both feet in X and
// Y (with margin).
const footSpanX = Math.abs(soleL.point[0] - soleR.point[0]);
const footSpanY = Math.abs(soleL.point[1] - soleR.point[1]);

const boardWidth = footSpanX + r.foot * 4.6; // covers the sideways spread + foot width
const boardLen = Math.max(rig.opts.height * 0.95, footSpanY + r.foot * 9); // long board, spans stagger
// Flat deck 0.75 above the (coplanar) sole plane: the foot hull's sole sits a
// hair above its nominal groundZ, so this leaves ~0.5 of the foot sunk into the
// deck and welded. The board's underside sits well below the soles.
const deckZ = highSole + 0.75;
const boardBottomZ = groundZ - 1.6;
const boardThick = deckZ - boardBottomZ;

// Plan shape and rails: an ellipsoid whose EQUATOR is the deck (widest at the
// deck plane, rounded rails curving in beneath), cut flat at the deck and at the
// underside. A gentle +Y widening (rate 0.006 per unit => nose ~0.84x, tail
// ~1.16x of the mid width, NOT the old 0.18 which collapsed the nose and
// ballooned the tail into a wedge) leaves a narrow pointed nose at −Y, the
// direction the figure faces.
const hull = sdf.ellipsoid(boardWidth * 0.5, boardLen * 0.5, boardThick * 1.5)
  .taper(0.006, 'y');
const slab = sdf.box([boardWidth * 3, boardLen * 2, boardThick])
  .translate([0, 0, -boardThick * 0.5]); // z in [-boardThick, 0]: deck at 0
const board = hull.intersect(slab)
  .translate([midX, midY, deckZ])
  .label('board');

// NOTE: no F.base is added — the board IS the stand. The deck (z = deckZ) is
// 0.5 above both soles, so each foot fuses into the board → one component.

// 7. Union all labelled regions and build with face/hand/foot detail.
// Global 0.58 grid keeps the whole figure (incl. the broad board) under the
// catalog triangle budget; the face/hand/foot detail regions still mesh those
// features finely regardless of the global grid.
const built = sdf.union(skin, eyes, nipples, lips, shorts, hair, board)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig, { edgeLength: rig.r.head * 0.06 }), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
// Rest the board's underside on z = 0 (exact: use the built mesh's bbox, since
// the marching-tetrahedra flat bottom lands a hair off the nominal plane).
return built.translate([0, 0, -built.boundingBox().min[2]]);
