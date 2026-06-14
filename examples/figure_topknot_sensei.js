// Tai-chi sensei — calm, centered, palms pressed together at the chest (gassho).
// Showcases DETAILED ears (helix rim + concha + earlobe), left fully exposed by
// a topknot BUN worn behind the ears. ~7 heads tall, solid build.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — grounded stance; both forearms swung forward and up so the hands
// meet at the centre of the chest.
const rig = F.rig({
  height: 64,
  headsTall: 7,
  build: 'average',
  age: 55,
  pose: {
    arms: { raiseSide: 16, raiseFwd: 50, bend: 116 },   // forearms in, hands meet at chest
    armL: { twist: 16 },
    armR: { twist: 16 },
    legL: { raiseSide: 8 },
    legR: { raiseSide: 8 },
    head: { pitch: 4 },        // chin slightly down — meditative
    spine: { lean: 1 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — broad calm face, DETAILED ears left exposed by the bun below.
const head = F.head(rig, { faceShape: 'square', jaw: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.12, width: 1.2, bridge: 0.9 },
  mouth: { style: 'lips', fullness: 1.0, width: r.head * 0.4 },
  ears: { type: 'detailed', size: r.head * 0.4 },   // ← anatomical ears
  brows: { thickness: 1.3 },
});
// Seat the eyeballs proud of the face so the eye paint regions stay resolvable.
const fwd = rig.dir.headForward, ep = r.head * 0.2;
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'hooded', gaze: 'down' })
  .translate([fwd[0] * ep, fwd[1] * ep, fwd[2] * ep]);

// 3. SKIN — hands in a soft open press.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — a wrap robe (long-sleeve top) over loose trousers, with a sash.
const robe = F.clothing.top(rig, { sleeve: 'long', thickness: r.chestY * 0.2 }).label('robe');
const trousers = F.clothing.pants(rig, { leg: 'cargo', rise: 'mid', thickness: r.upperLeg * 0.22 }).label('trousers');
// Sash: a torus belt at the natural waist, sized to the garment-fitting radius.
const sash = sdf.torus(r.waist * 1.04, r.waist * 0.16)
  .translate([0, -r.chestY * 0.4, j.spine[2]]).label('sash');

// 5. HAIR — topknot BUN worn behind the ears so the detailed ears read.
const hair = F.hair(rig, { style: 'bun', ears: 'behind', hairline: 'high' }).label('hair');

// 6. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 7. Union + build.
return sdf.union(skin, eyes, robe, trousers, sash, hair, base)
  .build({ edgeLength: 0.72, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06, eyeEdgeLength: r.head * 0.016, irisEdgeLength: r.head * 0.009 }), ...F.handDetail(rig)] });
