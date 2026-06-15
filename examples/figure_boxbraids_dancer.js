// Hip-Hop Freeze — a street dancer mid-freeze with mid-length box braids.
// Showcased features:
//   • 'boxBraids' hair style (thin hanging strands, fine mesh for clean strand geometry)
//   • Dynamic ground-supported freeze pose: one arm planted down, body tilted,
//     one knee tucked, opposite arm extended for the classic freeze line
//   • Bare midriff with navel on an athletic female body
//   • Crop top (sleeve:'none') + leggings + sneakers
// Paint regions: skin, eyes, iris, pupil, top, leggings, shoes, sole, hair, base
// Front = −Y, Z up. Figure's left = +X, right = −X.

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — female, average build, lean athletic body, freeze pose.
//    The freeze leans the torso sideways toward the planted arm; one leg tucked,
//    one extended. Spine tilt kept moderate so braids stay fused to the cap.
const rig = F.rig({
  height: 50,
  headsTall: 7.4,
  build: 'average',
  sex: 'female',
  muscle: 0.5,
  weight: 0.25,          // lean but not so thin that braid roots lose overlap
  pose: {
    // Left arm: planted forward-down to support the freeze
    armL: { raiseSide: 8, raiseFwd: -65, bend: 16 },
    // Right arm: extended out for the freeze silhouette line
    armR: { raiseSide: 80, raiseFwd: 16, bend: 14 },
    // Left leg: tucked up (knee pulled toward chest)
    legL: { raiseFwd: 55, bend: 85, raiseSide: 12 },
    // Right leg: extended behind/out
    legR: { raiseFwd: -15, bend: 8, raiseSide: 8 },
    // Spine: side tilt toward planted arm + lean — moderate to keep braids connected
    spine: { side: -15, lean: 12, turn: 8 },
    // Head: gazing forward, confident; counter-roll from spine tilt
    head: { yaw: 8, pitch: -4, roll: 4 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — heart-shaped face, broad nose, big confident smile.
const head = F.head(rig, { faceShape: 'heart', cheek: 1.1, jaw: 0.9 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', flare: 0.7, width: 1.05 },
  mouth: { style: 'lips', lipShape: 'full', fullness: 1.2, expression: 'bigSmile' },
  brows: { lift: 0.25 },
  ears: { size: r.head * 0.24 },
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.155, lids: 'upper' });

// 3. SKIN — bare midriff; navel shows between crop top and leggings.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. HAIR — mid-length box braids. Fine edgeLength keeps strand geometry clean.
const hair = F.hair(rig, { style: 'boxBraids', length: 'mid', volume: 1.0 }).label('hair');

// 5. CLOTHES — crop top (no sleeves) + full leggings + sneakers.
const top = F.clothing.top(rig, { sleeve: 'none' }).label('top');
const leggings = F.clothing.pants(rig, { rise: 'mid', leg: 'slim', length: 'full' }).label('leggings');
const shoes = F.clothing.shoes(rig);  // self-labels 'shoes' + 'sole'; no outer .label()

// 6. BASE — auto-sizes to the wide freeze stance footprint.
const base = F.base(rig).label('base');

// 7. Hard-union all labelled regions and build.
//    edgeLength 0.44 balances braid strand fidelity vs triangle budget.
return sdf.union(skin, eyes, hair, top, leggings, shoes, base)
  .build({
    edgeLength: 0.44,
    detail: [
      ...F.faceDetail(rig, { edgeLength: r.head * 0.065 }),
      ...F.handDetail(rig),
    ],
  });
