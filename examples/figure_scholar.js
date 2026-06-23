// Scholar — a showcase of the figure ACCESSORY ATTACHMENT system:
//   • Perched  → round eyeglasses on the face (F.onFace)
//   • Crowned  → a wide-brim hat seated on the hair (F.placeOnHead)
//   • Ringed   → a belt at the waist (F.ring)
// Front = −Y, Z up, figure-left = +X, figure-right = −X.
const { sdf } = api;
const F = sdf.figure;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (v) => Math.hypot(v[0], v[1], v[2]);

// 1. RIG — calm standing scholar.
const rig = F.rig({
  height: 64, headsTall: 6.5, build: 'slim',
  pose: {
    armL: { raiseSide: 9, bend: 14 }, armR: { raiseSide: 9, bend: 16 },
    legL: { raiseSide: 6 }, legR: { raiseSide: 6 }, head: { pitch: -1 },
  },
});
const j = rig.joints, r = rig.r, H = rig.opts.height;

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false, nose: { tipRadius: r.head * 0.09 },
  mouth: { style: 'lips', width: r.head * 0.30 }, ears: {}, brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });
const skin = F.weld(rig, [F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig), F.legs(rig), F.feet(rig), face]).label('skin');

// 3. COAT (long) + PANTS
const coat = F.clothing.top(rig, { sleeve: 'long', hemZ: H * 0.30, thickness: r.chestX * 0.13 }).label('coat');
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');

// 4. GLASSES (Perched) — round rims on the eyes, bridge, temples to the ears.
const ff = F.onFace(rig);
const eyeSpan = len(sub(ff.eyeL, ff.eyeR));
const lensRad = eyeSpan * 0.44, rim = lensRad * 0.20, temple = rim * 1.25, stand = r.head * 0.30;
function lensRim(c) {
  const N = 26, pts = [];
  for (let i = 0; i < N; i++) { const t = (2 * Math.PI * i) / N; pts.push(add(c, add(scale(ff.lateral, lensRad * Math.cos(t)), scale(ff.up, lensRad * Math.sin(t))))); }
  let ring = sdf.capsule(pts[N - 1], pts[0], rim);
  for (let i = 0; i < N - 1; i++) ring = ring.union(sdf.capsule(pts[i], pts[i + 1], rim));
  return ring;
}
const cL = add(ff.eyeL, scale(ff.forward, stand)), cR = add(ff.eyeR, scale(ff.forward, stand));
const sideL = add(add(ff.eyeL, scale(ff.lateral, r.headX * 0.55)), scale(ff.forward, -stand * 0.4));
const sideR = add(add(ff.eyeR, scale(ff.lateral, -r.headX * 0.55)), scale(ff.forward, -stand * 0.4));
const innerL = add(cL, scale(ff.lateral, -lensRad)), innerR = add(cR, scale(ff.lateral, lensRad));
const outerL = add(cL, scale(ff.lateral, lensRad)), outerR = add(cR, scale(ff.lateral, -lensRad));
const bridge = sdf.capsule(add(innerL, scale(ff.up, lensRad * 0.3)), add(innerR, scale(ff.up, lensRad * 0.3)), rim * 1.05);
const armL = sdf.capsule(outerL, sideL, temple).union(sdf.capsule(sideL, ff.templeL, temple));
const armR = sdf.capsule(outerR, sideR, temple).union(sdf.capsule(sideR, ff.templeR, temple));
const glasses = sdf.union(lensRim(cL), lensRim(cR), bridge, armL, armR).label('glasses');

// 5. HAT (Crowned) — wide brim + domed crown, seated on the hair.
const hR = Math.max(r.head, r.headX);
const brim = sdf.roundedCylinder(hR * 2.2, 1.5, 0.5).translate([0, 0, 0.75]);
const crownBody = sdf.roundedCylinder(hR * 1.05, hR * 1.3, 0.6).taper(-0.16, 'z').translate([0, 0, 1.5 + hR * 0.65]);
const crownTop = sdf.ellipsoid(hR * 0.9, hR * 0.9, hR * 0.5).translate([0, 0, 1.5 + hR * 1.3]);
const band = sdf.roundedCylinder(hR * 1.08, 1.2, 0.4).translate([0, 0, 1.5 + 0.6]);
const hatLocal = brim.smoothUnion(band, 0.5).smoothUnion(crownBody, 1.0).smoothUnion(crownTop, 0.8);
const hair = F.hair(rig, { style: 'short' }).label('hair');
// Seat the hat DOWN on the head (new default — brim near the brow), not perched
// high on the hair top. `sit` fine-tunes the brim height.
const hat = F.placeOnHead(hatLocal, rig, { sit: 0.30 }).label('hat');

// 6. BELT (Ringed) — a FLUSH band (F.band) that cinches FLAT over the robe. Arm-
// occlusion is handled by F.layers below (occludeArms = coat thickness), so the
// belt terminates at the coat SLEEVE instead of painting onto the arms (the
// regression the old skin-only `rig` occluder couldn't fix — it missed the sleeve).
const coatThick = r.chestX * 0.13;
const clothedBody = sdf.union(skin, coat, pants);
const belt = F.band(rig.ring.waist, {
  surface: clothedBody, thickness: r.waist * 0.10, height: r.chestX * 0.6,
  clearance: r.chestX * 0.02,
}).label('belt');
const bucklePt = F.ringPoint(rig.ring.waist, 0, { surface: clothedBody, clearance: r.chestX * 0.02 });
const buckle = sdf.roundedBox([r.waist * 0.5, r.waist * 0.22, r.chestX * 0.5], r.waist * 0.06).translate(bucklePt);
// Label the OUTER union (not just the parts): F.layers' occludeArms subtract only
// propagates a label from a single labeled child, so an unlabeled union-on-top
// would drop it and the belt would render uncoloured.
const beltWithBuckle = belt.union(buckle.label('belt')).label('belt');

// 7. BASE
const base = F.base(rig, { radius: H * 0.25 }).label('base');

// 9. COLOR
api.paint.label('skin', '#e0b48a');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#3a5a44');
api.paint.label('pupil', '#161616');
api.paint.label('lids', '#e0b48a');
api.paint.label('hair', '#6b5436');
api.paint.label('coat', '#3a4a63');
api.paint.label('pants', '#2c2f3a');
api.paint.label('glasses', '#2a2320');
api.paint.label('hat', '#5a4632');
api.paint.label('belt', '#3a2417');

api.paint.label('base', '#54504a');

// LAYERS — composite body + coat + belt with the belt arm-occluded (terminates at
// the coat sleeve, never bleeds onto the arms). Props (eyes, hair, glasses, hat,
// base) plain-unioned on top so they don't carve the garments.
const body = F.layers(rig, [
  { node: skin, carve: false, priority: 0 },
  { node: coat, carve: false, priority: 1 },
  { node: pants, carve: false, priority: 1 },
  { node: beltWithBuckle, carve: false, priority: 2, occludeArms: coatThick },
]);

return sdf.union(body, eyes, hair, glasses, hat, base)
  .build({ edgeLength: 0.38, detail: [...F.faceDetail(rig)] });
