// Pixie skater — bright, casual teen, hands on hips, weight cocked to one side.
// Showcases ROUND ears (the clean default type) left exposed by a cropped pixie
// cut worn BEHIND the ears. ~6.5 heads tall, average build.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — relaxed contrapposto; both hands planted on the hips (arms akimbo).
const rig = F.rig({
  height: 60,
  headsTall: 6.5,
  build: 'average',
  age: 16,
  pose: {
    // Hands on hips: arms out to the side and swung back, elbows bent hard so
    // the hands land on the waist.
    arms: { raiseSide: 42, raiseFwd: -22, bend: 115 },
    legL: { raiseSide: 8 },
    legR: { raiseSide: 6, raiseFwd: 6 },
    head: { yaw: 12, roll: -5 },     // jaunty tilt
    spine: { side: 6, turn: 4 },     // hip cocked
  },
});
const r = rig.r;

// 2. HEAD + FACE — round friendly face, ROUND ears exposed by the pixie below.
const head = F.head(rig, { faceShape: 'round' });
const mouthOpts = { style: 'smile', smirk: 0.5, width: r.head * 0.5 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.1, width: 1.0 },
  mouth: mouthOpts,
  ears: { type: 'round', size: r.head * 0.36 },   // ← clean cup ear
  brows: { lift: 0.8 },
});
// Seat the eyeballs proud of the face so the eye paint regions stay resolvable.
const fwd = rig.dir.headForward, ep = r.head * 0.2;
const eyes = F.face.eyes(rig, { radius: r.head * 0.17, lids: 'upper', gaze: 'left' })
  .translate([fwd[0] * ep, fwd[1] * ep, fwd[2] * ep]);

// 3. SKIN — hands relaxed (rest on the hips).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — graphic tee, cuffed cargo shorts, chunky sneakers.
const tee = F.clothing.top(rig, { sleeve: 'short', thickness: r.chestY * 0.2 }).label('tee');
const shorts = F.clothing.pants(rig, { leg: 'cargo', rise: 'mid', cuffZ: rig.joints.lowerLegL[2], thickness: r.upperLeg * 0.26 }).label('shorts');
const sneakers = F.clothing.shoes(rig, { label: 'sneaker' });   // self-labels 'sneaker' + 'sole'

// 5. HAIR — cropped pixie worn BEHIND the ears so the round ears show.
const hair = F.hair(rig, { style: 'short', length: 'short', ears: 'behind', part: 'left' }).label('hair');

// 6. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 7. Union + build.
return sdf.union(skin, eyes, tee, shorts, sneakers, hair, base)
  .build({ edgeLength: 0.7, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06, eyeEdgeLength: r.head * 0.016, irisEdgeLength: r.head * 0.009 }), ...F.handDetail(rig)] });
