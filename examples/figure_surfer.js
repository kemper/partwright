// Surfer — a male surfer riding a wave in a crouched stance on a surfboard,
// with sun-bleached locs. Showcased features:
//   • 'locs' hair style (rope strands, length:'long') — sun-bleached blond
//   • Surfboard as the BASE: a long tapered rounded slab beneath both feet
//   • Bare chest with navel; board shorts
//   • Bare feet with toes planted on the board; dynamic surf crouch with spine twist
// Paint regions: skin, eyes, iris, pupil, boardshorts, hair, board
// Front = −Y, Z up. Figure's left = +X, right = −X.

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tan male, tall & lean, surf riding crouch.
//    Wide athletic stance on the board; one arm forward, one back for balance;
//    torso pitched forward + spine twist (goofy-stance surfing feel).
const rig = F.rig({
  height: 56,
  headsTall: 7.6,
  build: 'average',
  sex: 'male',
  muscle: 0.55,
  weight: 0.3,
  pose: {
    // Wide surf stance — legs spread, knees bent deeply
    legL: { raiseSide: 14, bend: 45, raiseFwd: 5 },
    legR: { raiseSide: 14, bend: 48, raiseFwd: -5 },
    // Arms out for balance: left arm forward, right arm back
    armL: { raiseSide: 55, raiseFwd: 30, bend: 20 },
    armR: { raiseSide: 48, raiseFwd: -28, bend: 18 },
    // Torso pitched forward + twist
    spine: { lean: 12, turn: -10, side: 4 },
    // Gaze forward, relaxed smile
    head: { pitch: -6, yaw: -8 },
  },
});
const r = rig.r;

// 2. SURFBOARD — a long tapered rounded slab beneath both feet.
const boardLength = r.foot * 13;
const boardWidth  = r.foot * 3.2;
const boardThick  = r.foot * 0.65;

// Position: board top at the lowest sole Z
const soleZ = Math.min(rig.sole.L.groundZ, rig.sole.R.groundZ);
const boardCenterZ = soleZ - boardThick * 0.5;
const boardCenterX = (rig.sole.L.point[0] + rig.sole.R.point[0]) * 0.5;
const boardCenterY = (rig.sole.L.point[1] + rig.sole.R.point[1]) * 0.5;

// Rounded box tapered to surfboard silhouette (narrow nose + tail)
const boardShaped = sdf.roundedBox([boardLength, boardWidth, boardThick], boardThick * 0.38)
  .taper(-0.55, 'y')
  .translate([boardCenterX, boardCenterY, boardCenterZ])
  .label('board');

// 3. HEAD + FACE — oval face, relaxed smile, gaze forward.
const head = F.head(rig, { faceShape: 'oval', jaw: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', bridge: 1.0, width: 1.0 },
  mouth: { style: 'lips', lipShape: 'natural', fullness: 1.0, expression: 'smile' },
  brows: {},
  ears: { size: r.head * 0.25 },
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.155, lids: 'upper' });

// 4. SKIN — bare chest with navel; toes for the barefoot look.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 5. HAIR — long locs. volume 1.15 helps strands overlap the head cap securely.
//    Sun-bleached blond color set in the palette JSON.
const hair = F.hair(rig, { style: 'locs', length: 'long', volume: 1.15 }).label('hair');

// 6. BOARD SHORTS — low rise, briefs cut (short legs like boardshorts).
const boardshorts = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  length: 'briefs',
  thickness: r.upperLeg * 0.13,
}).label('boardshorts');

// 7. Hard-union. The surfboard is the base.
return sdf.union(skin, eyes, hair, boardshorts, boardShaped)
  .build({
    edgeLength: 0.48,
    detail: [
      ...F.faceDetail(rig, { edgeLength: r.head * 0.07 }),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
