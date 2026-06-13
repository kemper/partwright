// A casual character in chunky sneakers — a showcase for the figure footwear
// builder: F.clothing.shoes paints a separate contrasting 'sole' region, and
// F.ground plants both feet level on the base so the soles sit flush.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — relaxed standing, then GROUND so both feet share one plane (their
// soles come out coplanar on the base).
const rig = F.ground(F.rig({
  height: 60,
  headsTall: 6.5,
  build: 'average',
  pose: {
    armL: { raiseSide: 8, bend: 16 },
    armR: { raiseSide: 8, bend: 16 },
    legL: { raiseSide: 4 },
    legR: { raiseSide: 4 },
    head: { pitch: -2 },
  },
}), { mode: 'plant' });
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — friendly smile (eyes built at the top level, see below).
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.09 },
  mouth: { style: 'smile', width: r.head * 0.38 },
  ears:  { size: r.head * 0.22 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.16 });

// 3. SKIN
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. CLOTHES — slim jeans + a short-sleeve tee.
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');
const shirt = F.clothing.top(rig, { sleeve: 'short' }).label('shirt');

// 5. SNEAKERS — the star. Footwear OWNS its paint regions ('sneaker' upper +
// 'sole'); a chunky overhang sole reads as a trainer. Don't add .label() on top.
const shoes = F.clothing.shoes(rig, {
  label: 'sneaker',
  sole: { overhang: r.foot * 0.16, thickness: r.foot * 0.5 },
});

// 6. HAIR + BASE
const hair = F.hair(rig, { style: 'short' }).label('hair');
const base = F.base(rig).label('base');

return sdf.union(skin, eyes, pants, shirt, shoes, hair, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
