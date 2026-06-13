// Sprinter at the blocks — shows the figure builder's diversity axes: cornrows
// laid tight to the scalp (front hairline → crown → nape, with carved partings),
// a round face with a broad low-bridge nose and full lips, deep skin, and an
// athletic average build. Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — a ready, leaning-forward stance: one leg back, arms cocked.
const rig = F.rig({
  height: 64,
  headsTall: 7,
  build: 'average',
  sex: 'female',
  pose: {
    armL: { raiseSide: 14, raiseFwd: 35, bend: 70 },
    armR: { raiseSide: 14, raiseFwd: -35, bend: 70 },
    legL: { raiseSide: 7, raiseFwd: 20, bend: 20 },   // front leg
    legR: { raiseSide: 7, raiseFwd: -22, bend: 35 },  // back leg, driving
    spine: { lean: 12 },
    head: { pitch: -8, yaw: -6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — round face, broad low-bridge nose, full lips.
const head = F.head(rig, { faceShape: 'round' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { width: 1.4, bridge: 0.7, flare: 0.9 },
  mouth: { style: 'lips', fullness: 1.4, smirk: 0.15 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.15 });

// 3. SKIN — both hands in loose fists, ready.
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. HAIR — cornrows running back to a nape gather.
const hair = F.hair(rig, { style: 'cornrows', volume: 1.1 }).label('hair');

// 5. CLOTHES — a fitted athletic top + shorts.
const top = F.clothing.top(rig, { sleeve: 'none' }).label('top');
const shorts = F.clothing.pants(rig, { length: 'briefs' }).label('shorts');

// 6. BASE.
const base = F.base(rig).label('base');

return sdf.union(skin, eyes, hair, top, shorts, base)
  .build({ edgeLength: 0.62, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06 }), ...F.handDetail(rig)] });
