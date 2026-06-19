// Relaxed musician with shoulder-length locs — a deliberately mixed set of the
// figure builder's diversity axes (a long face + a narrower medium-bridge nose
// under the locs, medium-deep skin), so the catalog reads as individual people
// rather than one stereotype per hairstyle. Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — an easy contrapposto stance, weight on one leg, head tilted.
const rig = F.rig({
  height: 62,
  headsTall: 7.2,
  build: 'slim',
  sex: 'male',
  pose: {
    armL: { raiseSide: 10, bend: 22 },
    armR: { raiseSide: 12, raiseFwd: 8, bend: 30 },
    legL: { raiseSide: 5 },
    legR: { raiseSide: 9, twist: 8 },
    spine: { side: 4, turn: -5 },
    head: { yaw: 10, roll: -5 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — long face, narrower medium-bridge nose, medium lips.
const head = F.head(rig, { faceShape: 'long', jaw: 0.95 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { width: 0.95, bridge: 1.1, length: 1.1 },
  mouth: { style: 'lips', fullness: 1.0, smirk: 0.2 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'half' });

// 3. SKIN — relaxed hands.
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. HAIR — shoulder-length locs.
const hair = F.hair(rig, { style: 'locs', length: 'mid', volume: 1.05 }).label('hair');

// 5. CLOTHES — long-sleeve henley + slim trousers.
const top = F.clothing.top(rig, { sleeve: 'long' }).label('top');
const pants = F.clothing.pants(rig, { rise: 'mid', leg: 'slim' }).label('pants');

// 6. BASE.
const base = F.base(rig).label('base');

return sdf.union(skin, eyes, hair, top, pants, base)
  .build({ edgeLength: 0.62, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06 }), ...F.handDetail(rig)] });
