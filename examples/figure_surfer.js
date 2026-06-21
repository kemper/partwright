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
    // Low surf crouch: legs bent, a modest sideways spread, staggered fore/aft
    // (left foot leads −Y, right trails +Y) so both soles sit along the board's
    // long (Y) axis — a surf riding stance the board can span.
    legL: { raiseSide: 10, bend: 55, raiseFwd: 22 },
    legR: { raiseSide: 10, bend: 55, raiseFwd: -20 },
    // Torso leans slightly forward into the ride; head up, gaze ahead.
    spine: { lean: 10, turn: 6 },
    head: { pitch: -8, yaw: 6 },
  },
// 'drop' re-poses each leg (2-bone IK) so BOTH feet land coplanar on one ground
// plane — the asymmetric fore/aft surf stance otherwise leaves the soles ~4
// units apart in Z and the board can't weld both feet. Now the board top meets
// both soles flush → one component.
}), { mode: 'drop' });
const j = rig.joints, r = rig.r;

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

// 6. SURFBOARD — the base/stand. One long rounded board spanning both feet,
//    dropped onto the lower sole's ground plane and welded to BOTH feet so the
//    figure rests flat on the ground as a single component.
const soleL = rig.sole.L, soleR = rig.sole.R;
const groundZ = Math.min(soleL.groundZ, soleR.groundZ);
const highSole = Math.max(soleL.groundZ, soleR.groundZ);

// Board footprint centred between the two soles (in X/Y), board long axis along
// −Y/+Y (the direction of travel) so the fore/aft surf stance straddles it.
const midX = (soleL.point[0] + soleR.point[0]) * 0.5;
const midY = (soleL.point[1] + soleR.point[1]) * 0.5;

// Size the board off the ACTUAL stance footprint so it spans both feet in X and
// Y (with margin) and is thick enough that its TOP reaches up past the higher
// sole — guaranteeing both feet fuse into it (one component).
const footSpanX = Math.abs(soleL.point[0] - soleR.point[0]);
const footSpanY = Math.abs(soleL.point[1] - soleR.point[1]);

const boardWidth = footSpanX + r.foot * 4.6;     // covers the sideways spread + foot width
const boardLen = Math.max(rig.opts.height * 0.95, footSpanY + r.foot * 9);  // long board, spans stagger
// Bottom rests on the floor (z = groundZ); top must clear the higher sole so
// both feet seat into the board. Kept slim for a sleek surfboard deck — just
// enough thickness to bridge the small sole-height gap plus a thin foil.
const boardThick = (highSole - groundZ) + r.foot * 1.05;

// A surfboard is an elongated, flattened form pointed at the nose & tail. A
// flattened ellipsoid gives exactly that — wide middle, naturally tapered ends —
// far better than a tapered box (which pinches the middle). Stretch along Y
// (travel direction), flatten in Z; a mild forward taper sharpens the nose (+Y).
const board = sdf.ellipsoid(boardWidth * 0.5, boardLen * 0.5, boardThick * 0.5)
  .taper(0.18, 'y')
  .translate([midX, midY, groundZ + boardThick * 0.5])
  .label('board');

// NOTE: the board top overlaps both soles (soles sit at groundZ..above, board
// top is at groundZ + boardThick) so each foot fuses into the board → one
// component. No F.base is added — the board IS the stand and rests flat.

// 7. Union all labelled regions and build with face/hand/foot detail.
// Global 0.58 grid keeps the whole figure (incl. the broad board) under the
// catalog triangle budget; the face/hand/foot detail regions still mesh those
// features finely regardless of the global grid.
return sdf.union(skin, eyes, nipples, lips, shorts, hair, board)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig, { edgeLength: rig.r.head * 0.06 }), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
